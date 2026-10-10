import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
    await this.assertMatchingEngineInstalled();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Matching lives in a SQL function created by the `matching_engine` migration.
   * Prisma does not track functions, so a database that has only had
   * `prisma db push` run against it will be missing it — fail loudly at boot
   * rather than on the first citizen's search.
   */
  private async assertMatchingEngineInstalled(): Promise<void> {
    const [{ installed }] = await this.$queryRaw<[{ installed: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'match_schemes'
      ) AS installed
    `;

    if (!installed) {
      throw new Error(
        'match_schemes() is missing from the database. Run `npm run db:deploy` from the repo root.',
      );
    }
  }
}
