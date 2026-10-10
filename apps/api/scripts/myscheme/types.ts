import type { EligibilityRule, SchemeCategory } from '@sih/shared';

/** A scheme exactly as read off a myScheme detail page, before interpretation. */
export interface RawScheme {
  slug: string;
  sourceUrl: string;
  name: string;
  /** The header label above the title: either "Ministry Of ..." or a state name. */
  headerLabel: string;
  ministry: string;
  /** ISO 3166-2:IN code for state-administered schemes, null for central ones. */
  state: string | null;
  tags: string[];
  detailsText: string;
  benefitsText: string;
  eligibilityText: string;
  /** Exclusions carry real criteria (income-tax payers, government employees, …). */
  exclusionsText: string;
  documents: string[];
  applicationUrl: string;
  category: SchemeCategory;
  scrapedAt: string;
}

/** Why a normalised numeric value was accepted or thrown out. */
export interface GroundingFailure {
  field: string;
  value: number;
  reason: string;
}

export interface NormalizedScheme {
  rule: EligibilityRule;
  /** Set when an income ceiling was substituted for SECC/BPL deprivation criteria. */
  proxy: ProxyNote | null;
  /** Free-text justification from the normaliser, for the review report. */
  notes: string;
  normalizer: 'llm' | 'rules';
}

export interface ProxyNote {
  schemeName: string;
  sourceUrl: string;
  trigger: string;
  appliedIncomeCeiling: number;
  prose: string;
}

export type RejectionStage = 'extract' | 'normalize' | 'grounding' | 'zod' | 'insert';

/** Why a scheme was refused, before it is tied to a specific URL. */
export interface RejectionDetail {
  stage: RejectionStage;
  reason: string;
  details?: string[];
  /** The prose that could not be interpreted, so it can be fixed by hand. */
  prose?: string;
  /**
   * True when the cause was infrastructure (a rate limit, a timeout, a 5xx) rather
   * than the data. Transient failures stay retryable in the progress log and are
   * reported separately, so a throttled provider does not masquerade as 40 schemes
   * whose eligibility text a human needs to rewrite.
   */
  transient?: boolean;
}

export interface Rejection extends RejectionDetail {
  slug: string;
  sourceUrl: string;
  name: string;
}

export type SchemeOutcome =
  | { status: 'inserted'; slug: string; name: string; state: string | null }
  | { status: 'updated'; slug: string; name: string; state: string | null }
  | { status: 'skipped_duplicate'; slug: string; name: string; reason: string }
  | { status: 'rejected'; rejection: Rejection };

export interface RunTotals {
  discovered: number;
  visited: number;
  scraped: number;
  normalized: number;
  inserted: number;
  updated: number;
  skippedDuplicate: number;
  rejected: number;
  /** Infrastructure failures left retryable, counted apart from data rejections. */
  transientFailures: number;
  proxy: number;
}
