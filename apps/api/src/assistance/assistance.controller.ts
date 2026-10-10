import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applicationPackRequestSchema,
  updateApplicationStatusSchema,
  type ApplicationDashboard,
  type ApplicationPack,
  type ApplicationPackRequest,
  type TrackedApplication,
  type UpdateApplicationStatusInput,
} from '@sih/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssistanceService } from './assistance.service';
import { PortalStatusCheckerRegistry } from './portal-status-checker';
import { StatusTrackingService } from './status-tracking.service';

@ApiTags('assistance')
@Controller('assistance')
export class AssistanceController {
  constructor(
    private readonly assistance: AssistanceService,
    private readonly tracking: StatusTrackingService,
    private readonly portals: PortalStatusCheckerRegistry,
  ) {}

  @Post('pack')
  @ApiOperation({
    summary: 'Everything needed to apply for one scheme',
    description:
      'Document checklist marked against what the applicant likely already holds, a pre-filled ' +
      'summary for printing, the official application link, and a confidence rating. Schemes ' +
      'whose income ceiling is a PROXY for SECC/BPL criteria come back as PROXY_APPROXIMATED ' +
      'with a warning, and must not be shown with the same confidence as a hard-criteria match.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['schemeId', 'profile'],
      properties: {
        schemeId: { type: 'string', format: 'uuid' },
        profile: { type: 'object', description: 'The applicant profile, however complete' },
      },
    },
  })
  pack(
    @Body(new ZodValidationPipe(applicationPackRequestSchema)) request: ApplicationPackRequest,
  ): Promise<ApplicationPack> {
    return this.assistance.buildPack(request.schemeId, request.profile);
  }

  @Get('applications/:applicantId')
  @ApiOperation({
    summary: 'Status dashboard for one applicant',
    description:
      'Every tracked application with days since submission and since last check, both computed ' +
      'server-side so clients in different timezones agree. `needsAttention` flags filed ' +
      'applications that have gone quiet.',
  })
  dashboard(
    @Param('applicantId', ParseUUIDPipe) applicantId: string,
  ): Promise<ApplicationDashboard> {
    return this.tracking.dashboard(applicantId);
  }

  @Patch('applications/:id/status')
  @ApiOperation({
    summary: 'Record a status update by hand',
    description:
      'The primary way status changes, not a fallback: a citizen who was told something at a ' +
      'counter needs to record it, and no scraper can know that. Stamps appliedAt on the first ' +
      'transition to a filed status, and always refreshes lastCheckedAt.',
  })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateApplicationStatusSchema))
    input: UpdateApplicationStatusInput,
  ): Promise<TrackedApplication> {
    return this.tracking.updateStatus(id, input);
  }

  @Get('portal-checkers')
  @ApiOperation({
    summary: 'State of automated cross-portal status checking',
    description:
      'Reports which portal adapters are registered. Currently none by design — the architecture ' +
      'is defined in portal-status-checker.ts and status is maintained manually. This endpoint ' +
      'exists so the production path is visible rather than implied.',
  })
  portalCheckers(): { implemented: boolean; adapters: number; explanation: string } {
    return {
      implemented: !this.portals.isIdle,
      adapters: 0,
      explanation:
        'Automated checking is designed but not implemented. Each government portal needs its own ' +
        'adapter, most require the citizen’s own credentials or acknowledgement number, and status ' +
        'pages change without notice — a stale scraper reporting confidently is worse than manual ' +
        'entry. See the architecture notes in portal-status-checker.ts.',
    };
  }
}
