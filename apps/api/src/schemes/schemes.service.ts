import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeEligibility,
  type EligibilityRule,
  type Paginated,
  type SchemeDto,
  type SchemeInput,
  type SchemeQuery,
} from '@sih/shared';
import { toSchemeDto } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SchemesService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: SchemeQuery): Promise<Paginated<SchemeDto>> {
    const where: Prisma.SchemeWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      // 'CENTRAL' is the caller's way of asking for all-India schemes, which are
      // stored with a NULL administering state.
      ...(query.state ? { state: query.state === 'CENTRAL' ? null : query.state } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { ministry: { contains: query.search, mode: 'insensitive' } },
              { benefitText: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.scheme.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        take: query.take,
        skip: query.skip,
      }),
      this.prisma.scheme.count({ where }),
    ]);

    return { items: items.map(toSchemeDto), total, take: query.take, skip: query.skip };
  }

  async findOne(id: string): Promise<SchemeDto> {
    const scheme = await this.prisma.scheme.findUnique({ where: { id } });

    if (!scheme) {
      throw new NotFoundException(`Scheme ${id} not found`);
    }

    return toSchemeDto(scheme);
  }

  async create(input: SchemeInput): Promise<SchemeDto> {
    const scheme = await this.prisma.scheme.create({
      data: { ...input, eligibility: eligibilityToJson(input.eligibility) },
    });

    return toSchemeDto(scheme);
  }

  /**
   * Upsert keyed on (name, state) — the natural key a scraper re-encounters on
   * every run, so re-scraping updates a scheme in place instead of duplicating it.
   */
  async upsertByNaturalKey(input: SchemeInput): Promise<SchemeDto> {
    const existing = await this.prisma.scheme.findFirst({
      where: { name: input.name, state: input.state },
      select: { id: true },
    });

    const data = { ...input, eligibility: eligibilityToJson(input.eligibility) };

    const scheme = existing
      ? await this.prisma.scheme.update({ where: { id: existing.id }, data })
      : await this.prisma.scheme.create({ data });

    return toSchemeDto(scheme);
  }

  /** Facet counts for the browse UI, in one grouped query. */
  async countByCategory(): Promise<Array<{ category: string; count: number }>> {
    const grouped = await this.prisma.scheme.groupBy({
      by: ['category'],
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });

    return grouped.map((row) => ({ category: row.category, count: row._count._all }));
  }
}

/**
 * `EligibilityRule` is a plain JSON-shaped object, but Prisma's Json input type
 * is nominally distinct. Casting in exactly one place keeps the assertion
 * auditable — and it is only reached after Zod has validated the value.
 */
function eligibilityToJson(rule: EligibilityRule): Prisma.InputJsonObject {
  return normalizeEligibility(rule) as unknown as Prisma.InputJsonObject;
}
