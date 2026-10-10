import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applicantProfileSchema,
  matchRequestSchema,
  type ApplicantDto,
  type ApplicantProfile,
  type MatchResponse,
} from '@sih/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MatchingService } from '../matching/matching.service';
import { ApplicantsService } from './applicants.service';

/** Query options for the saved-applicant match endpoint (profile comes from the DB). */
const matchOptionsSchema = matchRequestSchema.omit({ profile: true });
type MatchOptions = z.infer<typeof matchOptionsSchema>;

@ApiTags('applicants')
@Controller('applicants')
export class ApplicantsController {
  constructor(
    private readonly applicantsService: ApplicantsService,
    private readonly matchingService: MatchingService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Save an applicant profile' })
  create(
    @Body(new ZodValidationPipe(applicantProfileSchema)) profile: ApplicantProfile,
  ): Promise<ApplicantDto> {
    return this.applicantsService.create(profile);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a saved applicant profile' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ApplicantDto> {
    return this.applicantsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Replace a saved applicant profile' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(applicantProfileSchema)) profile: ApplicantProfile,
  ): Promise<ApplicantDto> {
    return this.applicantsService.update(id, profile);
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Match a saved applicant against every scheme' })
  matches(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(matchOptionsSchema)) options: MatchOptions,
  ): Promise<MatchResponse> {
    return this.matchingService.matchForApplicant(id, options);
  }
}
