import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createApplicationSchema,
  updateApplicationSchema,
  type ApplicationDto,
  type CreateApplicationInput,
  type UpdateApplicationInput,
} from '@sih/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

@ApiTags('applications')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @ApiOperation({ summary: 'Start tracking an application for a scheme' })
  create(
    @Body(new ZodValidationPipe(createApplicationSchema)) input: CreateApplicationInput,
  ): Promise<ApplicationDto> {
    return this.applicationsService.create(input);
  }

  @Get()
  @ApiOperation({ summary: 'List the applications tracked for one applicant' })
  findByApplicant(
    @Query('applicantId', ParseUUIDPipe) applicantId: string,
  ): Promise<ApplicationDto[]> {
    return this.applicationsService.findByApplicant(applicantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update application status or notes' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateApplicationSchema)) input: UpdateApplicationInput,
  ): Promise<ApplicationDto> {
    return this.applicationsService.update(id, input);
  }
}
