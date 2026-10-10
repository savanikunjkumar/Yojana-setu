import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

interface HealthResponse {
  status: 'ok' | 'degraded';
  database: boolean;
  matchingEngine: boolean;
  schemes: number;
  uptimeSeconds: number;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness and readiness',
    description:
      'Reports whether the database is reachable, whether the match_schemes() SQL function ' +
      'is installed, and how many schemes are loaded — the three things that break a demo.',
  })
  async check(): Promise<HealthResponse> {
    let database = false;
    let matchingEngine = false;
    let schemes = 0;

    try {
      const [row] = await this.prisma.$queryRaw<[{ schemes: bigint; matcher: boolean }]>`
        SELECT
          (SELECT count(*) FROM public.schemes) AS schemes,
          EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'match_schemes'
          ) AS matcher
      `;
      database = true;
      matchingEngine = row.matcher;
      schemes = Number(row.schemes);
    } catch {
      database = false;
    }

    return {
      status: database && matchingEngine ? 'ok' : 'degraded',
      database,
      matchingEngine,
      schemes,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
