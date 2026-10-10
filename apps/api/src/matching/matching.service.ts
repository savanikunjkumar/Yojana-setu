import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applicantProfileSchema,
  computeNextQuestion,
  normalizeEligibility,
  profileCompleteness,
  toMatchInput,
  type ApplicantProfile,
  type EligibilityChecks,
  type EligibilityCriterion,
  type MatchRequest,
  type MatchResponse,
  type MatchedScheme,
  type SchemeCategory,
} from '@sih/shared';
import { decimalToNumber } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';

/** One row of `match_schemes()`. Column names are already camelCase in SQL. */
interface MatchRow {
  id: string;
  name: string;
  ministry: string;
  state: string | null;
  category: SchemeCategory;
  benefitText: string;
  applicationUrl: string;
  eligibility: unknown;
  requiredDocuments: string[];
  sourceUrl: string;
  lastScrapedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  proxyNote: string | null;
  checks: EligibilityChecks;
  failedCriteria: EligibilityCriterion[];
  unverifiedCriteria: EligibilityCriterion[];
  confirmedCount: number;
  isEligible: boolean;
  needsIncomeVerification: boolean;
  matchScore: number;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates every scheme against a profile in a single round trip.
   *
   * All the rule logic is in the `match_schemes()` SQL function; this method only
   * translates the profile into its JSONB input, then shapes the rows into the
   * response the UI wants. Deliberately no per-scheme loop, no second query, and
   * no rule interpretation in TypeScript — one place owns the rules.
   *
   * The ORDER BY re-states the function's own ordering because this query wraps it, and it
   * ranks on `confirmedCount` — a column the function returns rather than a count computed
   * here — so "how well does this match" has exactly one definition. Without it, schemes whose
   * prose yielded no rule tie on score with genuinely well-matched ones and win alphabetically.
   */
  async match(request: MatchRequest): Promise<MatchResponse> {
    const input = toMatchInput(request.profile);
    const startedAt = Date.now();

    const rows = await this.prisma.$queryRaw<MatchRow[]>(Prisma.sql`
      SELECT *
      FROM public.match_schemes(
        ${JSON.stringify(input)}::jsonb,
        ${request.maxFailures}::integer,
        ${request.category}::text
      )
      ORDER BY "isEligible" DESC, "confirmedCount" DESC, "matchScore" DESC, "name" ASC
    `);

    const matches = rows.map((row) => this.toMatchedScheme(row));

    this.logger.debug(
      `Matched ${matches.length} schemes in ${Date.now() - startedAt}ms ` +
        `(maxFailures=${request.maxFailures}, category=${request.category ?? 'all'})`,
    );

    // `nextQuestion` is derived before `confirmedOnly` trims the list: the whole
    // point is to surface the answer that would settle the schemes being dropped.
    const nextQuestion = computeNextQuestion(matches);

    const visible = request.confirmedOnly
      ? matches.filter((match) => match.unverifiedCriteria.length === 0)
      : matches;

    return {
      matches: visible.slice(0, request.limit),
      eligibleCount: matches.filter((match) => match.isEligible).length,
      nearMissCount: matches.filter((match) => !match.isEligible).length,
      consideredCount: matches.length,
      profileCompleteness: profileCompleteness(request.profile),
      nextQuestion,
    };
  }

  /** Same matcher, driven by a stored applicant instead of an inline profile. */
  async matchForApplicant(
    applicantId: string,
    options: Omit<MatchRequest, 'profile'>,
  ): Promise<MatchResponse> {
    const applicant = await this.prisma.applicant.findUnique({ where: { id: applicantId } });

    if (!applicant) {
      throw new NotFoundException(`Applicant ${applicantId} not found`);
    }

    const profile: ApplicantProfile = applicantProfileSchema.parse({
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
    });

    return this.match({ ...options, profile });
  }

  private toMatchedScheme(row: MatchRow): MatchedScheme {
    return {
      id: row.id,
      name: row.name,
      ministry: row.ministry,
      state: row.state,
      category: row.category,
      benefitText: row.benefitText,
      applicationUrl: row.applicationUrl,
      eligibility: normalizeEligibility(row.eligibility),
      requiredDocuments: row.requiredDocuments,
      sourceUrl: row.sourceUrl,
      lastScrapedAt: row.lastScrapedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      proxyNote: row.proxyNote,
      checks: row.checks,
      failedCriteria: row.failedCriteria,
      unverifiedCriteria: row.unverifiedCriteria,
      isEligible: row.isEligible,
      needsIncomeVerification: row.needsIncomeVerification,
      matchScore: row.matchScore,
    };
  }
}
