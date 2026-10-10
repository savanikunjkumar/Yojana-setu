import { Prisma, type PrismaClient } from '@prisma/client';
import type { EligibilityRule } from '@sih/shared';
import type { NormalizedScheme, RawScheme, SchemeOutcome } from './types';

/**
 * Names as they appear on different portals differ in whitespace, case and the
 * dashes used around an abbreviation, so duplicate detection compares a reduced
 * form. Kept narrow on purpose: it must not collapse two genuinely different
 * schemes whose names merely resemble each other.
 */
export function duplicateKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every scheme name already in the table, reduced for comparison. */
export async function loadExistingNames(prisma: PrismaClient): Promise<Map<string, string>> {
  const rows = await prisma.scheme.findMany({ select: { name: true } });
  return new Map(rows.map((row) => [duplicateKey(row.name), row.name]));
}

export interface PersistInput {
  scheme: RawScheme;
  normalized: NormalizedScheme;
  /** Combined eligibility and exclusions prose, stored verbatim. */
  rawEligibility: string;
}

/**
 * Writes one scheme.
 *
 * The rule reaching this point has already been through `safeNormalizeEligibility`,
 * which is what the table's CHECK constraint enforces independently — so a
 * constraint violation here would mean the two have drifted apart. That is worth
 * surfacing as a loud, specific failure rather than a generic insert error.
 */
export async function persistScheme(
  prisma: PrismaClient,
  input: PersistInput,
): Promise<SchemeOutcome> {
  const { scheme, normalized, rawEligibility } = input;

  const data = {
    name: scheme.name,
    ministry: scheme.ministry,
    state: scheme.state,
    category: scheme.category,
    benefitText: scheme.benefitsText || scheme.detailsText || scheme.name,
    applicationUrl: scheme.applicationUrl,
    eligibility: toJson(normalized.rule),
    rawEligibility,
    // Persisted so the UI can mark this match as weaker than a hard-criteria one.
    // Explicitly cleared when no proxy applies, so a re-normalisation that stops
    // needing the proxy does not leave a stale warning behind.
    proxyNote: normalized.proxy
      ? `Income ceiling of ₹${normalized.proxy.appliedIncomeCeiling.toLocaleString('en-IN')} is an approximation. ` +
        `The published criteria select beneficiaries by deprivation status (matched on "${normalized.proxy.trigger}"), ` +
        `which carries no income figure.`
      : null,
    requiredDocuments: scheme.documents,
    sourceUrl: scheme.sourceUrl,
    lastScrapedAt: new Date(scheme.scrapedAt),
  };

  try {
    // (name, state) is the natural key the schema already declares, so a re-scrape
    // updates in place rather than creating a second row for the same scheme.
    const existing = await prisma.scheme.findFirst({
      where: { name: scheme.name, state: scheme.state },
      select: { id: true },
    });

    if (existing) {
      await prisma.scheme.update({ where: { id: existing.id }, data });
      return { status: 'updated', slug: scheme.slug, name: scheme.name, state: scheme.state };
    }

    await prisma.scheme.create({ data });
    return { status: 'inserted', slug: scheme.slug, name: scheme.name, state: scheme.state };
  } catch (error) {
    return {
      status: 'rejected',
      rejection: {
        slug: scheme.slug,
        sourceUrl: scheme.sourceUrl,
        name: scheme.name,
        stage: 'insert',
        reason: describeDbError(error),
        prose: rawEligibility.slice(0, 400),
      },
    };
  }
}

function describeDbError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return 'a scheme with this name and state already exists';
    return `database error ${error.code}: ${error.message.split('\n').pop() ?? ''}`.trim();
  }

  const message = (error as Error).message ?? String(error);
  if (/schemes_eligibility_normalized/.test(message)) {
    return (
      'the eligibility CHECK constraint rejected this rule even though Zod accepted it — ' +
      'the Zod schema and the constraint have drifted apart and one of them needs fixing'
    );
  }
  return message.split('\n')[0] ?? 'unknown database error';
}

/**
 * `EligibilityRule` is already JSON-shaped, but Prisma's Json input type is
 * nominally distinct. The cast is confined to this one place, and is only reached
 * for values Zod has validated.
 */
function toJson(rule: EligibilityRule): Prisma.InputJsonObject {
  return rule as unknown as Prisma.InputJsonObject;
}
