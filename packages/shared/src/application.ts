import { z } from 'zod';
import { APPLICATION_STATUSES } from './enums';
import type { ApplicationStatus } from './enums';
import type { SchemeDto } from './scheme';

export interface ApplicationDto {
  id: string;
  applicantId: string;
  schemeId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  lastCheckedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present when the caller asked for the scheme to be included. */
  scheme?: SchemeDto;
}

export const createApplicationSchema = z
  .object({
    applicantId: z.string().uuid(),
    schemeId: z.string().uuid(),
    status: z.enum(APPLICATION_STATUSES).default('NOT_STARTED'),
    notes: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

/** Statuses that mean the citizen has actually filed something. */
export const ACTIVE_STATUSES: ApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

/** `appliedAt` is stamped the first time an application reaches a filed status. */
export function shouldStampAppliedAt(
  previous: ApplicationStatus,
  next: ApplicationStatus,
): boolean {
  const filed: ApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];
  return !filed.includes(previous) && filed.includes(next);
}
