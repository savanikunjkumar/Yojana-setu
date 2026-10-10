import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { matchRequestSchema, type MatchRequest, type MatchResponse } from '@sih/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MatchingService } from './matching.service';

@ApiTags('matching')
@Controller('matching')
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Post()
  // POST because the request carries a profile body, but it is a pure read.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Match an applicant profile against every scheme',
    description:
      'Runs the entire rule set in one SQL statement. Unanswered profile fields come back ' +
      'as UNKNOWN criteria rather than rejections, and `nextQuestion` names the single ' +
      'most useful follow-up to ask. Set `maxFailures` above 0 to include near misses.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        profile: {
          type: 'object',
          example: {
            age: 34,
            gender: 'MALE',
            incomeBracket: 'INR_1L_TO_2_5L',
            occupation: 'FARMER',
            state: 'IN-BR',
            district: 'Gaya',
            socialCategory: 'OBC',
            landHolding: 1.2,
            isStudent: false,
            hasDisability: false,
          },
        },
        maxFailures: { type: 'integer', example: 0, minimum: 0, maximum: 3 },
        category: { type: 'string', nullable: true, example: null },
        confirmedOnly: { type: 'boolean', example: false },
        limit: { type: 'integer', example: 50 },
      },
      required: ['profile'],
    },
  })
  match(
    @Body(new ZodValidationPipe(matchRequestSchema)) request: MatchRequest,
  ): Promise<MatchResponse> {
    return this.matchingService.match(request);
  }
}
