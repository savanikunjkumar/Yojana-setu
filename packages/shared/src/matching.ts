import { z } from 'zod';
import { applicantProfileSchema, PROFILE_FIELDS, type ApplicantProfile } from './applicant';
import { SCHEME_CATEGORIES } from './enums';
import {
  ELIGIBILITY_CRITERION_META,
  type EligibilityCriterion,
  type CriterionMeta,
} from './eligibility';
import type { SchemeDto } from './scheme';

/**
 * Every criterion resolves to one of three states — the third is what makes a
 * voice-first flow workable, since a half-finished profile must not be treated
 * as a rejection.
 *
 *   PASS    — the applicant satisfies it
 *   FAIL    — the applicant definitively does not satisfy it
 *   UNKNOWN — the profile lacks the answer, or the reported income bracket
 *             straddles the scheme's income cap
 */
export const CHECK_RESULTS = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export type EligibilityChecks = Record<EligibilityCriterion, CheckResult>;

/**
 * `rawEligibility` is deliberately omitted: it is the full published prose, often several
 * kilobytes, and a match response carries up to 200 schemes. Fetch a single scheme, or an
 * application pack, when the source text is actually needed.
 *
 * `proxyNote` is kept, because a caller cannot judge how much to trust a match without it.
 */
export interface MatchedScheme extends Omit<SchemeDto, 'rawEligibility'> {
  /** True when no criterion FAILed. UNKNOWNs do not block eligibility. */
  isEligible: boolean;
  /** 0–100 ranking hint: 100 = fully confirmed, penalised per FAIL and UNKNOWN. */
  matchScore: number;
  checks: EligibilityChecks;
  failedCriteria: EligibilityCriterion[];
  unverifiedCriteria: EligibilityCriterion[];
  /** The applicant's income bracket spans this scheme's cap — needs an exact figure. */
  needsIncomeVerification: boolean;
}

export const matchRequestSchema = z
  .object({
    profile: applicantProfileSchema,
    /**
     * 0 returns only schemes the applicant can actually get. 1–2 additionally
     * returns near misses, which is how the UI explains "you just miss out on
     * this one, and here is why".
     */
    maxFailures: z.coerce.number().int().min(0).max(3).default(0),
    category: z.enum(SCHEME_CATEGORIES).nullable().default(null),
    /** Drop schemes that still have unanswered criteria. */
    confirmedOnly: z.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type MatchRequest = z.infer<typeof matchRequestSchema>;
export type MatchRequestInput = z.input<typeof matchRequestSchema>;

/** The single highest-value follow-up question for the voice assistant to ask. */
export interface NextQuestion extends CriterionMeta {
  criterion: EligibilityCriterion;
  /** Profile field the answer should be written to. */
  field: keyof ApplicantProfile;
  /** How many otherwise-eligible schemes this one answer would settle. */
  unlocks: number;
}

export interface MatchResponse {
  matches: MatchedScheme[];
  eligibleCount: number;
  nearMissCount: number;
  /** Schemes evaluated by the matcher after the category filter. */
  consideredCount: number;
  profileCompleteness: number;
  nextQuestion: NextQuestion | null;
}

/**
 * Picks the question that resolves the most currently-unverified criteria.
 *
 * Grouped by profile field rather than by criterion, because one answer can
 * settle several criteria at once — "how old are you?" resolves both `minAge`
 * and `maxAge`. Ties break toward the earlier field in `PROFILE_FIELDS`, which
 * is ordered easiest-to-answer first.
 */
export function computeNextQuestion(matches: MatchedScheme[]): NextQuestion | null {
  const tally = new Map<
    keyof ApplicantProfile,
    { criterion: EligibilityCriterion; count: number }
  >();

  for (const match of matches) {
    // Only count schemes still within reach; a hard FAIL cannot be talked away.
    if (match.failedCriteria.length > 0) continue;

    const seenFields = new Set<keyof ApplicantProfile>();
    for (const criterion of match.unverifiedCriteria) {
      const field = ELIGIBILITY_CRITERION_META[criterion].answeredBy as keyof ApplicantProfile;
      if (seenFields.has(field)) continue;
      seenFields.add(field);

      const entry = tally.get(field);
      if (entry) {
        entry.count += 1;
      } else {
        tally.set(field, { criterion, count: 1 });
      }
    }
  }

  if (tally.size === 0) return null;

  const ranked = [...tally.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return fieldPriority(a[0]) - fieldPriority(b[0]);
  });

  const best = ranked[0];
  if (!best) return null;

  const [field, { criterion, count }] = best;
  return { ...ELIGIBILITY_CRITERION_META[criterion], criterion, field, unlocks: count };
}

function fieldPriority(field: keyof ApplicantProfile): number {
  const index = (PROFILE_FIELDS as readonly (keyof ApplicantProfile)[]).indexOf(field);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Groups failures so the UI can say "3 schemes need a disability certificate". */
export function summarizeFailures(matches: MatchedScheme[]): Array<{
  criterion: EligibilityCriterion;
  label: string;
  count: number;
}> {
  const tally = new Map<EligibilityCriterion, number>();
  for (const match of matches) {
    for (const criterion of match.failedCriteria) {
      tally.set(criterion, (tally.get(criterion) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .map(([criterion, count]) => ({
      criterion,
      label: ELIGIBILITY_CRITERION_META[criterion].label,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}
