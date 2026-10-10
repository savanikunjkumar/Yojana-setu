import { z } from 'zod';
import { applicantProfileSchema, type ApplicantProfile } from './applicant';
import { APPLICATION_STATUSES, type ApplicationStatus } from './enums';
import type { MatchedScheme } from './matching';
import type { SchemeDto } from './scheme';

/**
 * Application assistance: what a citizen needs *after* being told they match.
 *
 * Knowing you qualify is the easy half. The gap that actually stops people is not
 * knowing which documents to carry, what to write on the form, and where to go — so
 * this turns a match into a checklist, a pre-filled summary and a link.
 */

/**
 * Whether the applicant is likely to already hold a document.
 *
 * "Likely" is doing real work in that name. Nothing here can know what is in someone's
 * cupboard; it infers from what they told us — an applicant who gave a social category
 * probably holds the caste certificate that category came from. So this is a sorting
 * aid for the citizen's own preparation, never a claim about their paperwork, and the
 * wording in the UI has to keep that distinction.
 */
export const DOCUMENT_LIKELIHOODS = ['LIKELY_HAVE', 'NEED_TO_OBTAIN', 'UNKNOWN'] as const;
export type DocumentLikelihood = (typeof DOCUMENT_LIKELIHOODS)[number];

export interface DocumentChecklistItem {
  document: string;
  likelihood: DocumentLikelihood;
  /** Why we guessed that, shown to the user so the guess is auditable. */
  reason: string;
  /** Profile field the inference came from, if any. */
  basedOn: keyof ApplicantProfile | null;
}

/** One field of the pre-filled summary sheet. */
export interface PrefilledField {
  label: string;
  value: string | null;
  /** Null values are printed as blank lines for the applicant to complete by hand. */
  field: keyof ApplicantProfile | null;
}

/**
 * How much weight a match can bear.
 *
 * `PROXY_APPROXIMATED` exists because some schemes select beneficiaries from SECC/BPL
 * deprivation lists that carry no income figure at all. The scraper substitutes a
 * ceiling so they can be matched — that substitution is ours, not the ministry's, and a
 * match resting on it is not the same claim as a match against a published rule.
 * Presenting the two identically would overstate what we know.
 */
export const MATCH_CONFIDENCES = ['CONFIRMED', 'NEEDS_ANSWERS', 'PROXY_APPROXIMATED'] as const;
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number];

export interface ApplicationPack {
  scheme: SchemeDto;
  confidence: MatchConfidence;
  /** Present only for PROXY schemes: what was approximated, and what to verify. */
  proxyWarning: string | null;
  checklist: DocumentChecklistItem[];
  prefilled: PrefilledField[];
  /** Criteria still unanswered, which the applicant should settle before applying. */
  unverifiedCriteria: string[];
  applyUrl: string;
  sourceUrl: string;
}

export const applicationPackRequestSchema = z
  .object({
    schemeId: z.string().uuid(),
    profile: applicantProfileSchema,
  })
  .strict();

export type ApplicationPackRequest = z.infer<typeof applicationPackRequestSchema>;

/**
 * Confidence for a matched scheme. PROXY outranks the others because it is a statement
 * about the *rule* being approximate, which no amount of answering can fix.
 */
export function matchConfidence(
  scheme: Pick<MatchedScheme, 'unverifiedCriteria'> & {
    proxyNote?: string | null;
  },
): MatchConfidence {
  if (scheme.proxyNote) return 'PROXY_APPROXIMATED';
  if (scheme.unverifiedCriteria.length > 0) return 'NEEDS_ANSWERS';
  return 'CONFIRMED';
}

export const MATCH_CONFIDENCE_LABELS: Record<MatchConfidence, string> = {
  CONFIRMED: 'Meets every stated criterion',
  NEEDS_ANSWERS: 'Likely — a few answers still needed',
  PROXY_APPROXIMATED: 'Approximate — official criteria differ',
};

// --- Status tracking ---------------------------------------------------------

export interface TrackedApplication {
  id: string;
  applicantId: string;
  schemeId: string;
  schemeName: string;
  schemeState: string | null;
  applyUrl: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  lastCheckedAt: string | null;
  notes: string | null;
  createdAt: string;
  /** Whole days since filing, computed server-side so every client agrees. */
  daysSinceApplied: number | null;
  daysSinceChecked: number | null;
  /** True when a filed application has gone a long time without an update. */
  needsAttention: boolean;
}

export interface ApplicationDashboard {
  applications: TrackedApplication[];
  counts: Record<ApplicationStatus, number>;
  totalTracked: number;
  needingAttention: number;
}

/**
 * A filed application with no movement for this long is worth chasing. Indian scheme
 * processing genuinely takes weeks, so the threshold is deliberately generous — the
 * point is to catch the forgotten ones, not to imply a service-level guarantee.
 */
export const STALE_AFTER_DAYS = 30;

export const updateApplicationStatusSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export type UpdateApplicationStatusInput = z.infer<typeof updateApplicationStatusSchema>;

export function daysBetween(from: string | Date, to: Date = new Date()): number {
  const start = typeof from === 'string' ? new Date(from) : from;
  return Math.max(0, Math.floor((to.getTime() - start.getTime()) / 86_400_000));
}
