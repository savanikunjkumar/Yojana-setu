import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  schemeInputSchema,
  schemeQuerySchema,
  type Paginated,
  type SchemeDto,
  type SchemeInput,
  type SchemeQuery,
  type SchemeStats,
} from '@sih/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SchemesService } from './schemes.service';
import { StatsService } from './stats.service';

@ApiTags('schemes')
@Controller('schemes')
export class SchemesController {
  constructor(
    private readonly schemesService: SchemesService,
    private readonly statsService: StatsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Browse schemes by category, state or free text' })
  findMany(
    @Query(new ZodValidationPipe(schemeQuerySchema)) query: SchemeQuery,
  ): Promise<Paginated<SchemeDto>> {
    return this.schemesService.findMany(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Scheme counts per category, for browse facets' })
  countByCategory(): Promise<Array<{ category: string; count: number }>> {
    return this.schemesService.countByCategory();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Corpus statistics, including how much of it we could actually extract',
    description:
      'Coverage percentages are over scraped schemes only, and are deliberately published ' +
      'rather than hidden: they are modest, and an honest number is more defensible than an ' +
      'implication that the data is complete. `proxyCount` is how many schemes rest on an ' +
      'approximated income ceiling.',
  })
  stats(): Promise<SchemeStats> {
    return this.statsService.summary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single scheme' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SchemeDto> {
    return this.schemesService.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a scheme',
    description:
      'Intended for the scraper and admin tooling. The eligibility payload is normalized ' +
      'and rejected outright if it contains unknown keys or contradictory bounds.',
  })
  create(@Body(new ZodValidationPipe(schemeInputSchema)) input: SchemeInput): Promise<SchemeDto> {
    return this.schemesService.create(input);
  }
}
