/**
 * Backfills the two eligibility fixes onto schemes already in the database, without
 * calling an LLM.
 *
 *   npm run backfill            # apply
 *   npm run backfill -- --dry-run
 *
 * WHY THIS EXISTS INSTEAD OF RE-RUNNING THE SCRAPER
 * A full `--from-archive` re-normalisation is one LLM call per scheme. On Groq's free
 * tier that is 8,000 tokens per minute against roughly 2,900 tokens per request — about
 * fifty minutes for 132 schemes, most of it spent waiting on rate limits. Neither fix
 * needs a model:
 *
 *   - the occupation recovery is a pure function over the stored prose, and
 *   - the PROXY decision is the same deterministic test the normaliser itself applied
 *     (deprivation wording present, and the income cap equal to the substituted ceiling).
 *
 * So both are reproduced exactly, in seconds. New scrapes still get `proxyNote` written
 * from the normaliser's own decision in `persist.ts`; this only fills in rows that were
 * written before that column existed.
 *
 * Every rewritten rule goes through `safeNormalizeEligibility` before it is saved, so
 * this cannot introduce a rule the CHECK constraint would reject.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { ANY, formatINR, safeNormalizeEligibility, type EligibilityRule } from '@sih/shared';
import { recoverOccupationGate } from './myscheme/mapping';
import { DEPRIVATION } from './myscheme/normalize-rules';

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const PROXY_CEILING = Number(
  argv.find((arg) => arg.startsWith('--proxy-income='))?.split('=')[1] ?? 100_000,
);

interface Change {
  name: string;
  occupation?: { from: string[]; to: string[] };
  proxyApplied?: boolean;
}

async function main(): Promise<void> {
  const schemes = await prisma.scheme.findMany({
    where: { rawEligibility: { not: null } },
    select: { id: true, name: true, eligibility: true, rawEligibility: true, proxyNote: true },
  });

  console.log(`Examining ${schemes.length} scraped schemes${DRY_RUN ? ' (dry run)' : ''}\n`);

  const changes: Change[] = [];
  let invalid = 0;

  for (const scheme of schemes) {
    const prose = scheme.rawEligibility ?? '';
    const parsed = safeNormalizeEligibility(scheme.eligibility);

    if (!parsed.success) {
      // A stored rule that no longer validates is a real problem, but not one to paper
      // over by rewriting it here.
      console.log(`SKIP  ${scheme.name} — stored rule fails validation`);
      invalid += 1;
      continue;
    }

    const rule: EligibilityRule = parsed.data;
    const change: Change = { name: scheme.name };
    let nextRule = rule;

    // --- occupation recovery ---
    const isWildcard = rule.occupation.includes(ANY);
    const isOtherOnly = rule.occupation.length === 1 && rule.occupation[0] === 'OTHER';

    if (isWildcard || isOtherOnly) {
      const recovered = recoverOccupationGate(prose);
      if (recovered) {
        const revalidated = safeNormalizeEligibility({ ...rule, occupation: recovered });
        if (revalidated.success) {
          nextRule = revalidated.data;
          change.occupation = { from: rule.occupation, to: recovered };
        }
      }
    }

    // --- PROXY note ---
    // Reproduces the normaliser's own test rather than guessing: deprivation wording
    // present, and the income cap sitting exactly on the substituted ceiling.
    const trigger = prose.match(DEPRIVATION);
    const needsProxyNote =
      scheme.proxyNote === null && trigger !== null && rule.maxAnnualIncome === PROXY_CEILING;

    const proxyNote = needsProxyNote
      ? `Income ceiling of ₹${PROXY_CEILING.toLocaleString('en-IN')} is an approximation. ` +
        `The published criteria select beneficiaries by deprivation status (matched on "${trigger?.[0]}"), ` +
        `which carries no income figure.`
      : null;

    if (needsProxyNote) change.proxyApplied = true;

    if (!change.occupation && !change.proxyApplied) continue;

    changes.push(change);

    if (!DRY_RUN) {
      await prisma.scheme.update({
        where: { id: scheme.id },
        data: {
          ...(change.occupation
            ? { eligibility: nextRule as unknown as Prisma.InputJsonObject }
            : {}),
          ...(proxyNote ? { proxyNote } : {}),
        },
      });
    }

    const parts: string[] = [];
    if (change.occupation) {
      parts.push(
        `occupation ${change.occupation.from.join('/')} → ${change.occupation.to.join('/')}`,
      );
    }
    if (change.proxyApplied) parts.push(`PROXY note (${formatINR(PROXY_CEILING)})`);
    console.log(
      `${DRY_RUN ? 'would fix' : 'fixed  '} ${scheme.name}\n           ${parts.join('; ')}`,
    );
  }

  const occupationFixed = changes.filter((change) => change.occupation).length;
  const proxyMarked = changes.filter((change) => change.proxyApplied).length;

  console.log(
    [
      '',
      '─'.repeat(60),
      `  examined            ${schemes.length}`,
      `  occupation fixed    ${occupationFixed}`,
      `  PROXY marked        ${proxyMarked}`,
      `  unchanged           ${schemes.length - changes.length}`,
      `  stored rule invalid ${invalid}`,
      '─'.repeat(60),
      DRY_RUN ? '\nDry run — nothing was written.' : '',
    ].join('\n'),
  );
}

main()
  .catch((error) => {
    console.error('\nBackfill failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
