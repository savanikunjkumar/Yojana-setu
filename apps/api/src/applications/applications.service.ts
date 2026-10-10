import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  shouldStampAppliedAt,
  type ApplicationDto,
  type CreateApplicationInput,
  type UpdateApplicationInput,
} from '@sih/shared';
import { toApplicationDto } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateApplicationInput): Promise<ApplicationDto> {
    try {
      const application = await this.prisma.application.create({
        data: {
          applicantId: input.applicantId,
          schemeId: input.schemeId,
          status: input.status,
          notes: input.notes,
          appliedAt: shouldStampAppliedAt('NOT_STARTED', input.status) ? new Date() : null,
        },
        include: { scheme: true },
      });

      return toApplicationDto(application);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('This applicant is already tracking this scheme');
        }
        if (error.code === 'P2003') {
          throw new NotFoundException('Unknown applicant or scheme');
        }
      }
      throw error;
    }
  }

  async findByApplicant(applicantId: string): Promise<ApplicationDto[]> {
    const applications = await this.prisma.application.findMany({
      where: { applicantId },
      include: { scheme: true },
      orderBy: [{ createdAt: 'desc' }],
    });

    return applications.map(toApplicationDto);
  }

  async update(id: string, input: UpdateApplicationInput): Promise<ApplicationDto> {
    const existing = await this.prisma.application.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Application ${id} not found`);
    }

    const stampAppliedAt =
      input.status !== undefined &&
      existing.appliedAt === null &&
      shouldStampAppliedAt(existing.status, input.status);

    const application = await this.prisma.application.update({
      where: { id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(stampAppliedAt ? { appliedAt: new Date() } : {}),
        // Every status change is a fresh confirmation of where the application stands.
        lastCheckedAt: new Date(),
      },
      include: { scheme: true },
    });

    return toApplicationDto(application);
  }
}
