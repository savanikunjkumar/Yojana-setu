import { z } from 'zod';
import { GENDERS, OCCUPATIONS, SOCIAL_CATEGORIES } from './enums';
import { formatINR } from './constants/income-brackets';
import { isRegionCode, regionName } from './constants/states';

/**
 * ============================================================================
 * The eligibility rule contract
 * ============================================================================
 *
 * A scheme's eligibility lives in a single JSONB column (`schemes.eligibility`)
 * so that scrapers can add schemes without a migration. To keep matching to
 * *one* SQL statement, the encoding follows two rules that never vary:
 *
 *   1. NUMERIC bounds use `null` to mean "unbounded".
 *      SQL side: `COALESCE((eligibility->>'minAge')::int, 0)` — absence becomes
 *      a bound that is trivially satisfied, so no OR branches are needed.
 *
 *   2. CATEGORICAL fields use the wildcard `'*'` to mean "anyone qualifies",
 *      and are ALWAYS present (arrays are never empty or missing).
 *      SQL side: `eligibility->'states' ?| ARRAY['IN-BR', '*']` — a single
 *      GIN-indexable containment test covers both "matches" and "unrestricted".
 *
 * The second rule is what makes the matcher a flat conjunction of predicates
 * instead of a pile of NULL checks, so it is enforced in three places:
 * `normalizeEligibility()` here, a CHECK constraint on the table, and the
 * seed/import path which must call the normalizer before writing.
 *
 * Never hand-write this JSON — always pipe it through `normalizeEligibility()`.
 */

/** Wildcard sentinel for categorical criteria: "this criterion excludes nobody". */
export const ANY = '*';
export type Any = typeof ANY;

const regionCode = z
  .string()
  .transform((value) => value.toUpperCase())
  .refine(isRegionCode, { message: 'Must be an ISO 3166-2:IN code such as IN-BR' });

const wildcard = z.literal(ANY);

/** Collapses `['*', 'SC']` to `['*']`, dedupes, and sorts for stable diffs/snapshots. */
function normalizeSet<T extends string>(values: readonly (T | Any)[]): (T | Any)[] {
  if (values.length === 0 || values.includes(ANY)) return [ANY];
  return [...new Set(values)].sort();
}

export const eligibilityRuleSchema = z
  .object({
    /** Inclusive lower bound on age in years. `null` = no lower bound. */
    minAge: z.number().int().min(0).max(120).nullable().default(null),
    /** Inclusive upper bound on age in years. `null` = no upper bound. */
    maxAge: z.number().int().min(0).max(120).nullable().default(null),
    /** Inclusive cap on annual household income in rupees. `null` = no cap. */
    maxAnnualIncome: z.number().int().min(0).max(100_000_000).nullable().default(null),
    /** A single target gender, or `'*'` for all genders. */
    gender: z.union([z.enum(GENDERS), wildcard]).default(ANY),
    socialCategory: z
      .array(z.union([z.enum(SOCIAL_CATEGORIES), wildcard]))
      .default([ANY])
      .transform(normalizeSet),
    occupation: z
      .array(z.union([z.enum(OCCUPATIONS), wildcard]))
      .default([ANY])
      .transform(normalizeSet),
    /** ISO 3166-2:IN codes whose residents qualify, or `['*']` for all-India. */
    states: z
      .array(z.union([regionCode, wildcard]))
      .default([ANY])
      .transform(normalizeSet),
    /** Inclusive cap on land holding in HECTARES. `null` = not land-tested. */
    maxLandHolding: z.number().nonnegative().max(10_000).nullable().default(null),
    /** True = only persons with a benchmark disability qualify. */
    requiresDisability: z.boolean().default(false),
    /** True = only currently-enrolled students qualify. */
    isStudentOnly: z.boolean().default(false),
  })
  // Reject unknown keys: a typo like `maxIncome` would otherwise silently widen
  // eligibility to everyone, which is the worst possible failure for a citizen.
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.minAge !== null && rule.maxAge !== null && rule.minAge > rule.maxAge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minAge'],
        message: `minAge (${rule.minAge}) cannot exceed maxAge (${rule.maxAge})`,
      });
    }
    if (rule.isStudentOnly && !rule.occupation.includes(ANY)) {
      const allowsStudent = rule.occupation.includes('STUDENT');
      if (!allowsStudent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['occupation'],
          message: 'isStudentOnly is set but occupation[] excludes STUDENT, so nobody can match',
        });
      }
    }
  });

/** Fully normalized rule: every key present, wildcards materialized. Safe for SQL. */
export type EligibilityRule = z.infer<typeof eligibilityRuleSchema>;

/** Authoring shape: everything optional, for seeds, scrapers and admin forms. */
export type EligibilityRuleInput = z.input<typeof eligibilityRuleSchema>;

/**
 * Validates and canonicalizes a rule. Throws `ZodError` on malformed input —
 * loudly failing an import is preferable to persisting a rule that quietly
 * matches the wrong people.
 */
export function normalizeEligibility(input: EligibilityRuleInput | unknown): EligibilityRule {
  return eligibilityRuleSchema.parse(input ?? {});
}

export function safeNormalizeEligibility(
  input: unknown,
): { success: true; data: EligibilityRule } | { success: false; error: z.ZodError } {
  const result = eligibilityRuleSchema.safeParse(input ?? {});
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/** A rule that excludes nobody — the starting point when authoring a new scheme. */
export const UNRESTRICTED_ELIGIBILITY: EligibilityRule = normalizeEligibility({});

/** Metadata per criterion: what to show, and what to ask when the answer is missing. */
export interface CriterionMeta {
  readonly label: string;
  /** Asked by the voice assistant when this criterion evaluates to UNKNOWN. */
  readonly question: string;
  readonly questionHi: string;
  /** Which applicant profile field answers this criterion. */
  readonly answeredBy: string;
}

/**
 * `satisfies Record<keyof EligibilityRule, ...>` makes this exhaustive in both
 * directions: adding a rule field without metadata, or metadata for a field that
 * does not exist, both fail `npm run typecheck`.
 */
export const ELIGIBILITY_CRITERION_META = {
  minAge: {
    label: 'Minimum age',
    question: 'How old are you?',
    questionHi: 'आपकी उम्र क्या है?',
    answeredBy: 'age',
  },
  maxAge: {
    label: 'Maximum age',
    question: 'How old are you?',
    questionHi: 'आपकी उम्र क्या है?',
    answeredBy: 'age',
  },
  maxAnnualIncome: {
    label: 'Income limit',
    question: 'What is your total yearly family income?',
    questionHi: 'आपके परिवार की सालाना आय कितनी है?',
    answeredBy: 'incomeBracket',
  },
  gender: {
    label: 'Gender',
    question: 'What is your gender?',
    questionHi: 'आपका लिंग क्या है?',
    answeredBy: 'gender',
  },
  socialCategory: {
    label: 'Social category',
    question: 'Which category do you belong to — General, OBC, SC, ST or minority?',
    questionHi: 'आप किस वर्ग से हैं — सामान्य, ओबीसी, एससी, एसटी या अल्पसंख्यक?',
    answeredBy: 'socialCategory',
  },
  occupation: {
    label: 'Occupation',
    question: 'What work do you do?',
    questionHi: 'आप क्या काम करते हैं?',
    answeredBy: 'occupation',
  },
  states: {
    label: 'State',
    question: 'Which state do you live in?',
    questionHi: 'आप किस राज्य में रहते हैं?',
    answeredBy: 'state',
  },
  maxLandHolding: {
    label: 'Land holding limit',
    question: 'How much farm land does your family own, in hectares?',
    questionHi: 'आपके परिवार के पास कितनी ज़मीन है, हेक्टेयर में?',
    answeredBy: 'landHolding',
  },
  requiresDisability: {
    label: 'Disability requirement',
    question: 'Do you have a certified disability?',
    questionHi: 'क्या आपके पास दिव्यांगता प्रमाण पत्र है?',
    answeredBy: 'hasDisability',
  },
  isStudentOnly: {
    label: 'Student requirement',
    question: 'Are you currently studying?',
    questionHi: 'क्या आप अभी पढ़ाई कर रहे हैं?',
    answeredBy: 'isStudent',
  },
} satisfies Record<keyof EligibilityRule, CriterionMeta>;

export type EligibilityCriterion = keyof typeof ELIGIBILITY_CRITERION_META;

/** Criterion keys, identical to the keys returned in `checks` by `match_schemes()`. */
export const ELIGIBILITY_CRITERIA = Object.keys(
  ELIGIBILITY_CRITERION_META,
) as EligibilityCriterion[];

/** Renders a rule as citizen-readable bullet points, for cards and voice read-out. */
export function describeEligibility(rule: EligibilityRule): string[] {
  const lines: string[] = [];

  if (rule.minAge !== null && rule.maxAge !== null) {
    lines.push(`Age ${rule.minAge}–${rule.maxAge} years`);
  } else if (rule.minAge !== null) {
    lines.push(`Age ${rule.minAge} years or above`);
  } else if (rule.maxAge !== null) {
    lines.push(`Age up to ${rule.maxAge} years`);
  }

  if (rule.maxAnnualIncome !== null) {
    lines.push(`Annual family income up to ${formatINR(rule.maxAnnualIncome)}`);
  }
  if (rule.gender !== ANY) {
    lines.push(`For ${rule.gender.toLowerCase()} applicants`);
  }
  if (!rule.socialCategory.includes(ANY)) {
    lines.push(`Category: ${rule.socialCategory.join(', ')}`);
  }
  if (!rule.occupation.includes(ANY)) {
    lines.push(`Occupation: ${rule.occupation.map(humanize).join(', ')}`);
  }
  if (!rule.states.includes(ANY)) {
    lines.push(`Residents of ${rule.states.map(regionName).join(', ')}`);
  }
  if (rule.maxLandHolding !== null) {
    lines.push(`Land holding up to ${rule.maxLandHolding} hectares`);
  }
  if (rule.requiresDisability) {
    lines.push('Certified disability required');
  }
  if (rule.isStudentOnly) {
    lines.push('Must be currently enrolled in study');
  }

  return lines.length > 0 ? lines : ['Open to all citizens'];
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .join(' ')
    .replace(/^./, (char) => char.toUpperCase());
}
