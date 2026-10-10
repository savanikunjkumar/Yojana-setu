import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { AssistanceController } from './assistance.controller';
import { AssistanceService } from './assistance.service';
import { PortalStatusCheckerRegistry } from './portal-status-checker';
import { StatusTrackingService } from './status-tracking.service';

@Module({
  // Per-criterion verdicts come from the existing matcher rather than being recomputed,
  // so an application pack can never disagree with the match that led the user to it.
  imports: [MatchingModule],
  controllers: [AssistanceController],
  providers: [AssistanceService, StatusTrackingService, PortalStatusCheckerRegistry],
  // Exported so the voice layer can speak a status summary without duplicating the logic.
  exports: [StatusTrackingService],
})
export class AssistanceModule {}
