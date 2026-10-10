import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  // Typed as the Express app so the body-parser limit below can be raised.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.enableShutdownHooks();

  // Voice sends audio as base64 JSON, which comfortably exceeds Express's 100kb
  // default. A few seconds of Opus is tens of kilobytes; 12mb leaves room for a long
  // answer recorded on a phone without inviting abuse.
  app.useBodyParser('json', { limit: '12mb' });

  if (config.get('ENABLE_SWAGGER', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Scheme Eligibility Matcher API')
        .setDescription(
          'Voice-enabled government scheme eligibility matcher — Smart India Hackathon 2026.\n\n' +
            'Eligibility is evaluated by a single PostgreSQL function, `match_schemes()`. Every ' +
            'criterion returns PASS, FAIL or UNKNOWN, so a partially answered profile narrows ' +
            'results instead of rejecting the applicant.',
        )
        .setVersion('0.1.0')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  logger.log(`API listening on http://localhost:${port}/api`);
  if (config.get('ENABLE_SWAGGER', { infer: true })) {
    logger.log(`Swagger UI on http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
