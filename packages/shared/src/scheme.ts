import { z } from 'zod';
import { SCHEME_CATEGORIES } from './enums';
import type { SchemeCategory } from './enums';
import { eligibilityRuleSchema, type EligibilityRule } from './eligibility';
import { isRegionCode } from './constants/states';

/** A scheme as returned over HTTP. Timestamps are ISO strings, not `Date`. */
export interface SchemeDto {
  id: string;
  name: string;
  ministry: string;
  /** ISO 3166-2:IN code of the administering state, or `null` for central schemes. */
  state: string | null;
  category: SchemeCategory;
  benefitText: string;
  applicationUrl: string;
  eligibility: EligibilityRule;
  requiredDocuments: string[];
  sourceUrl: string;
  lastScrapedAt: string | null;
  /** The eligibility prose as published, for schemes imported by the scraper. */
  rawEligibility: string | null;
  /**
   * Non-null when this scheme's income ceiling is an approximation of SECC/BPL
   * deprivation criteria rather than a published figure. Its presence downgrades the
   * confidence of any match against it.
   */
  proxyNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export const schemeInputSchema = z
  .object({
    name: z.string().trim().min(3).max(300),
    ministry: z.string().trim().min(2).max(200),
    state: z
      .string()
      .transform((value) => value.toUpperCase())
      .refine(isRegionCode, { message: 'Must be an ISO 3166-2:IN code such as IN-BR' })
      .nullable()
      .default(null),
    category: z.enum(SCHEME_CATEGORIES),
    benefitText: z.string().trim().min(3).max(2000),
    applicationUrl: z.string().url(),
    eligibility: eligibilityRuleSchema,
    requiredDocuments: z.array(z.string().trim().min(1).max(200)).default([]),
    sourceUrl: z.string().url(),
    lastScrapedAt: z.coerce.date().nullable().default(null),
  })
  .strict();

export type SchemeInput = z.infer<typeof schemeInputSchema>;

export const schemeQuerySchema = z
  .object({
    category: z.enum(SCHEME_CATEGORIES).optional(),
    /** `IN-BR` for Bihar schemes, `CENTRAL` for all-India schemes. */
    state: z
      .string()
      .transform((value) => value.toUpperCase())
      .refine((value) => value === 'CENTRAL' || isRegionCode(value))
      .optional(),
    search: z.string().trim().min(2).max(120).optional(),
    take: z.coerce.number().int().min(1).max(100).default(20),
    skip: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type SchemeQuery = z.infer<typeof schemeQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  take: number;
  skip: number;
}

/**
 * Corpus statistics, published rather than hidden.
 *
 * Coverage percentages are computed over *scraped* schemes only — the hand-authored seed
 * rows would flatter the extractor with rules it never had to read out of prose.
 */
export interface SchemeStats {
  total: number;
  central: number;
  stateLevel: number;
  distinctStates: number;
  scraped: number;
  handAuthored: number;
  /** Percentage of scraped schemes carrying each criterion. */
  coverage: {
    ageBound: number;
    incomeCap: number;
    occupation: number;
    gender: number;
    socialCategory: number;
    landCeiling: number;
    studentOnly: number;
  };
  /** Schemes whose income ceiling approximates SECC/BPL criteria. */
  proxyCount: number;
  lastScrapedAt: string | null;
  byCategory: Array<{ category: SchemeCategory; count: number }>;
}
