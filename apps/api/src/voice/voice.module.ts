import { Module } from '@nestjs/common';
import { AssistanceModule } from '../assistance/assistance.module';
import { MatchingModule } from '../matching/matching.module';
import { ProfileExtractionService } from './profile-extraction.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  // Voice reuses the existing matcher and the existing status tracker rather than
  // reimplementing any part of either.
  imports: [MatchingModule, AssistanceModule],
  controllers: [VoiceController],
  providers: [VoiceService, ProfileExtractionService],
})
export class VoiceModule {}
