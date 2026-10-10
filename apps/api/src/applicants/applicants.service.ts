import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApplicantDto, ApplicantProfile } from '@sih/shared';
import { toApplicantDto } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApplicantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(profile: ApplicantProfile): Promise<ApplicantDto> {
    const applicant = await this.prisma.applicant.create({ data: toPrismaData(profile) });
    return toApplicantDto(applicant);
  }

  async findOne(id: string): Promise<ApplicantDto> {
    const applicant = await this.prisma.applicant.findUnique({ where: { id } });

    if (!applicant) {
      throw new NotFoundException(`Applicant ${id} not found`);
    }

    return toApplicantDto(applicant);
  }

  /**
   * Replaces the stored profile. A voice session sends the whole profile each
   * time it learns something new, so partial-vs-full update semantics never
   * become ambiguous: the client always owns the complete picture.
   */
  async update(id: string, profile: ApplicantProfile): Promise<ApplicantDto> {
    await this.findOne(id);

    const applicant = await this.prisma.applicant.update({
      where: { id },
      data: toPrismaData(profile),
    });

    return toApplicantDto(applicant);
  }
}

function toPrismaData(profile: ApplicantProfile): Prisma.ApplicantCreateInput {
  return {
    age: profile.age,
    gender: profile.gender,
    incomeBracket: profile.incomeBracket,
    occupation: profile.occupation,
    state: profile.state,
    district: profile.district,
    socialCategory: profile.socialCategory,
    landHolding:
      profile.landHolding === null ? null : new Prisma.Decimal(profile.landHolding.toFixed(4)),
    isStudent: profile.isStudent,
    hasDisability: profile.hasDisability,
  };
}
