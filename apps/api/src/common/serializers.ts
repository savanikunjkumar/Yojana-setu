import { Prisma, type Applicant, type Application, type Scheme } from '@prisma/client';
import {
  normalizeEligibility,
  type ApplicantDto,
  type ApplicationDto,
  type SchemeDto,
} from '@sih/shared';

/**
 * Prisma hands back `Date` and `Decimal` instances; HTTP responses need ISO
 * strings and plain numbers. Doing that conversion in one place keeps the wire
 * format identical to the DTOs the frontend imports from @sih/shared.
 */

export function toSchemeDto(scheme: Scheme): SchemeDto {
  return {
    id: scheme.id,
    name: scheme.name,
    ministry: scheme.ministry,
    state: scheme.state,
    category: scheme.category,
    benefitText: scheme.benefitText,
    applicationUrl: scheme.applicationUrl,
    // Re-validating on the way out turns a hand-edited or badly imported row
    // into a loud error instead of a silently malformed API response.
    eligibility: normalizeEligibility(scheme.eligibility),
    requiredDocuments: scheme.requiredDocuments,
    sourceUrl: scheme.sourceUrl,
    lastScrapedAt: scheme.lastScrapedAt?.toISOString() ?? null,
    rawEligibility: scheme.rawEligibility,
    proxyNote: scheme.proxyNote,
    createdAt: scheme.createdAt.toISOString(),
    updatedAt: scheme.updatedAt.toISOString(),
  };
}

export function toApplicantDto(applicant: Applicant): ApplicantDto {
  return {
    id: applicant.id,
    age: applicant.age,
    gender: applicant.gender,
    incomeBracket: applicant.incomeBracket,
    occupation: applicant.occupation,
    state: applicant.state,
    district: applicant.district,
    socialCategory: applicant.socialCategory,
    landHolding: decimalToNumber(applicant.landHolding),
    isStudent: applicant.isStudent,
    hasDisability: applicant.hasDisability,
    createdAt: applicant.createdAt.toISOString(),
  };
}

export function toApplicationDto(
  application: Application & { scheme?: Scheme | null },
): ApplicationDto {
  return {
    id: application.id,
    applicantId: application.applicantId,
    schemeId: application.schemeId,
    status: application.status,
    appliedAt: application.appliedAt?.toISOString() ?? null,
    lastCheckedAt: application.lastCheckedAt?.toISOString() ?? null,
    notes: application.notes,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    ...(application.scheme ? { scheme: toSchemeDto(application.scheme) } : {}),
  };
}

export function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}
