import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  daysBetween,
  regionName,
  shouldStampAppliedAt,
  STALE_AFTER_DAYS,
  type ApplicationDashboard,
  type ApplicationStatus,
  type TrackedApplication,
  type UpdateApplicationStatusInput,
} from '@sih/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Statuses where the application is with the department and waiting on them. */
const AWAITING_DEPARTMENT: ApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

@Injectable()
export class StatusTrackingService {
  private readonly logger = new Logger(StatusTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every application one applicant is tracking, with elapsed times computed here.
   *
   * Day counts are server-side on purpose: a browser in a different timezone would
   * otherwise show a different "days since submission" for the same row, and this
   * number is the one a citizen quotes when they ring the department.
   */
  async dashboard(applicantId: string): Promise<ApplicationDashboard> {
    const rows = await this.prisma.application.findMany({
      where: { applicantId },
      include: { scheme: true },
      orderBy: [{ createdAt: 'desc' }],
    });

    const now = new Date();
    const applications: TrackedApplication[] = rows.map((row) => {
      const daysSinceApplied = row.appliedAt ? daysBetween(row.appliedAt, now) : null;
      const daysSinceChecked = row.lastCheckedAt ? daysBetween(row.lastCheckedAt, now) : null;

      return {
        id: row.id,
        applicantId: row.applicantId,
        schemeId: row.schemeId,
        schemeName: row.scheme.name,
        schemeState: row.scheme.state,
        applyUrl: row.scheme.applicationUrl,
        status: row.status,
        appliedAt: row.appliedAt?.toISOString() ?? null,
        lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
        notes: row.notes,
        createdAt: row.createdAt.toISOString(),
        daysSinceApplied,
        daysSinceChecked,
        needsAttention:
          AWAITING_DEPARTMENT.includes(row.status) &&
          (daysSinceChecked ?? daysSinceApplied ?? 0) >= STALE_AFTER_DAYS,
      };
    });

    const counts = Object.fromEntries(
      APPLICATION_STATUSES.map((status) => [
        status,
        applications.filter((application) => application.status === status).length,
      ]),
    ) as Record<ApplicationStatus, number>;

    return {
      applications,
      counts,
      totalTracked: applications.length,
      needingAttention: applications.filter((application) => application.needsAttention).length,
    };
  }

  /**
   * Manual status update — the path that always works.
   *
   * Automated checking (see `portal-status-checker.ts`) can only ever cover portals we
   * have written an adapter for, and government portals change without notice. A person
   * who has just been told something at a counter must be able to record it, so this
   * stays the primary mechanism rather than a fallback.
   */
  async updateStatus(id: string, input: UpdateApplicationStatusInput): Promise<TrackedApplication> {
    const existing = await this.prisma.application.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Application ${id} not found`);
    }

    const stampAppliedAt =
      existing.appliedAt === null && shouldStampAppliedAt(existing.status, input.status);

    await this.prisma.application.update({
      where: { id },
      data: {
        status: input.status,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(stampAppliedAt ? { appliedAt: new Date() } : {}),
        // Any manual update is a fresh confirmation of where things stand.
        lastCheckedAt: new Date(),
      },
    });

    this.logger.log(`Application ${id}: ${existing.status} → ${input.status}`);

    const dashboard = await this.dashboard(existing.applicantId);
    const updated = dashboard.applications.find((application) => application.id === id);
    if (!updated) {
      throw new NotFoundException(`Application ${id} not found after update`);
    }
    return updated;
  }

  /**
   * Spoken status summary.
   *
   * Returns plain prose rather than audio: synthesis belongs to the voice layer's TTS
   * provider chain, which already handles Sarvam-then-browser fallback. Duplicating
   * that here would mean two things to keep working.
   *
   * Phrased for listening, not reading — short sentences, no counts the listener has to
   * hold in their head, and the thing needing action said last so it is what they
   * remember.
   */
  async spokenSummary(applicantId: string, language: string): Promise<string> {
    const dashboard = await this.dashboard(applicantId);
    const hindi = language.startsWith('hi');

    if (dashboard.totalTracked === 0) {
      return hindi
        ? 'आपने अभी किसी योजना के लिए आवेदन शुरू नहीं किया है।'
        : 'You have not started any applications yet.';
    }

    const parts: string[] = [];
    const { counts } = dashboard;

    if (hindi) {
      parts.push(`आपके ${dashboard.totalTracked} आवेदन दर्ज हैं।`);
      if (counts.APPROVED > 0) parts.push(`${counts.APPROVED} स्वीकृत हो गए हैं।`);
      if (counts.UNDER_REVIEW > 0) parts.push(`${counts.UNDER_REVIEW} जाँच में हैं।`);
      if (counts.SUBMITTED > 0) parts.push(`${counts.SUBMITTED} जमा किए गए हैं।`);
      if (counts.IN_PROGRESS > 0) parts.push(`${counts.IN_PROGRESS} अधूरे हैं।`);
      if (counts.REJECTED > 0) parts.push(`${counts.REJECTED} अस्वीकृत हुए हैं।`);
    } else {
      parts.push(
        `You are tracking ${dashboard.totalTracked} application${dashboard.totalTracked === 1 ? '' : 's'}.`,
      );
      if (counts.APPROVED > 0) parts.push(`${counts.APPROVED} approved.`);
      if (counts.UNDER_REVIEW > 0) parts.push(`${counts.UNDER_REVIEW} under review.`);
      if (counts.SUBMITTED > 0) parts.push(`${counts.SUBMITTED} submitted and waiting.`);
      if (counts.IN_PROGRESS > 0) parts.push(`${counts.IN_PROGRESS} still in progress.`);
      if (counts.REJECTED > 0) parts.push(`${counts.REJECTED} rejected.`);
    }

    // The actionable item goes last: it is what someone remembers from spoken audio.
    const stale = dashboard.applications.filter((application) => application.needsAttention);
    if (stale[0]) {
      const name = stale[0].schemeName;
      const days = stale[0].daysSinceChecked ?? stale[0].daysSinceApplied ?? 0;
      parts.push(
        hindi
          ? `${name} का ${days} दिन से कोई अपडेट नहीं आया है। कार्यालय में पूछताछ करें।`
          : `${name} has had no update for ${days} days. It is worth following up.`,
      );
    } else if (dashboard.applications[0]) {
      const latest = dashboard.applications[0];
      parts.push(
        hindi
          ? `सबसे नया आवेदन ${latest.schemeName} है।`
          : `Your most recent one is ${latest.schemeName}, currently ${APPLICATION_STATUS_LABELS[latest.status].toLowerCase()}.`,
      );
    }

    return parts.join(' ');
  }

  /** Human-readable one-liner used by the dashboard and the printable summary. */
  describe(application: TrackedApplication): string {
    const where = application.schemeState ? regionName(application.schemeState) : 'Central';
    return `${application.schemeName} (${where}) — ${APPLICATION_STATUS_LABELS[application.status]}`;
  }
}
