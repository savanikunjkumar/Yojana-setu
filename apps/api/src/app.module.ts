import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApplicantsModule } from './applicants/applicants.module';
import { ApplicationsModule } from './applications/applications.module';
import { AssistanceModule } from './assistance/assistance.module';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { MatchingModule } from './matching/matching.module';
import { PrismaModule } from './prisma/prisma.module';
import { SchemesModule } from './schemes/schemes.module';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // One .env at the repo root serves docker-compose, Prisma and this API, so
      // credentials are never defined in two places. The local override is listed
      // second for deployments that inject a per-app file.
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
      cache: true,
    }),
    PrismaModule,
    SchemesModule,
    ApplicantsModule,
    ApplicationsModule,
    MatchingModule,
    AssistanceModule,
    VoiceModule,
    HealthModule,
  ],
})
export class AppModule {}
