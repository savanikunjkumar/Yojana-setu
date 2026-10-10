import { z } from 'zod';
import { GENDERS, INCOME_BRACKETS, OCCUPATIONS, SOCIAL_CATEGORIES } from './enums';
import type { Gender, IncomeBracket, Occupation, SocialCategory } from './enums';
import { INCOME_BRACKET_BOUNDS } from './constants/income-brackets';
import { isRegionCode } from './constants/states';

/**
 * Every field is nullable on purpose. A voice conversation builds the profile
 * incrementally, so "not asked yet" is the normal state — and the matcher
 * reports such criteria as UNKNOWN instead of silently failing the applicant.
 */
export const applicantProfileSchema = z
  .object({
    age: z.number().int().min(0).max(120).nullable().default(null),
    gender: z.enum(GENDERS).nullable().default(null),
    incomeBracket: z.enum(INCOME_BRACKETS).nullable().default(null),
    occupation: z.enum(OCCUPATIONS).nullable().default(null),
    /** ISO 3166-2:IN code, e.g. `IN-BR`. */
    state: z
      .string()
      .transform((value) => value.toUpperCase())
      .refine(isRegionCode, { message: 'Must be an ISO 3166-2:IN code such as IN-BR' })
      .nullable()
      .default(null),
    district: z.string().trim().min(1).max(120).nullable().default(null),
    socialCategory: z.enum(SOCIAL_CATEGORIES).nullable().default(null),
    /** Agricultural land owned, in HECTARES (see `acresToHectares`). */
    landHolding: z.number().nonnegative().max(10_000).nullable().default(null),
    isStudent: z.boolean().nullable().default(null),
    hasDisability: z.boolean().nullable().default(null),
  })
  .strict();

export type ApplicantProfile = z.infer<typeof applicantProfileSchema>;
export type ApplicantProfileInput = z.input<typeof applicantProfileSchema>;

export const EMPTY_PROFILE: ApplicantProfile = applicantProfileSchema.parse({});

export interface ApplicantDto extends ApplicantProfile {
  id: string;
  createdAt: string;
}

/**
 * The exact JSONB payload accepted by the `match_schemes(jsonb, int)` SQL function.
 *
 * The income bracket is resolved to numeric bounds here rather than in SQL, so the
 * database never needs to know bracket names: it only compares numbers. A bracket
 * spanning a scheme's income cap yields UNKNOWN rather than a guess, which is why
 * both bounds are sent.
 *
 *   - `annualIncomeLower === null` → income not disclosed yet (UNKNOWN)
 *   - `annualIncomeUpper === null` → top open-ended bracket (unbounded above)
 */
export interface MatchInput {
  age: number | null;
  gender: Gender | null;
  annualIncomeLower: number | null;
  annualIncomeUpper: number | null;
  occupation: Occupation | null;
  socialCategory: SocialCategory | null;
  state: string | null;
  landHolding: number | null;
  isStudent: boolean | null;
  hasDisability: boolean | null;
}

export function toMatchInput(profile: ApplicantProfile): MatchInput {
  const bounds = profile.incomeBracket ? INCOME_BRACKET_BOUNDS[profile.incomeBracket] : null;
  return {
    age: profile.age,
    gender: profile.gender,
    annualIncomeLower: bounds ? bounds.lower : null,
    annualIncomeUpper: bounds ? bounds.upper : null,
    occupation: profile.occupation,
    socialCategory: profile.socialCategory,
    state: profile.state,
    landHolding: profile.landHolding,
    isStudent: profile.isStudent,
    hasDisability: profile.hasDisability,
  };
}

/** Profile fields that influence matching, in the order worth asking about. */
export const PROFILE_FIELDS = [
  'age',
  'state',
  'incomeBracket',
  'occupation',
  'socialCategory',
  'gender',
  'landHolding',
  'isStudent',
  'hasDisability',
] as const satisfies readonly (keyof ApplicantProfile)[];

/** 0–1 fraction of match-relevant fields answered, for the progress indicator. */
export function profileCompleteness(profile: ApplicantProfile): number {
  const answered = PROFILE_FIELDS.filter((field) => profile[field] !== null).length;
  return answered / PROFILE_FIELDS.length;
}

export function bracketLabel(bracket: IncomeBracket): string {
  return INCOME_BRACKET_BOUNDS[bracket].label;
}

/** Land records are quoted in acres in much of India; schemes are written in hectares. */
export function acresToHectares(acres: number): number {
  return Number((acres * 0.404686).toFixed(4));
}

export function hectaresToAcres(hectares: number): number {
  return Number((hectares / 0.404686).toFixed(4));
}
