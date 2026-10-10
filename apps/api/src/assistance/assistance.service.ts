import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ELIGIBILITY_CRITERION_META,
  GENDER_LABELS,
  INCOME_BRACKET_BOUNDS,
  OCCUPATION_LABELS,
  SOCIAL_CATEGORY_LABELS,
  matchConfidence,
  regionName,
  type ApplicantProfile,
  type ApplicationPack,
  type PrefilledField,
  type SchemeDto,
} from '@sih/shared';
import { toSchemeDto } from '../common/serializers';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildDocumentChecklist } from './document-inference';

@Injectable()
export class AssistanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
  ) {}

  /**
   * Everything needed to actually apply for one scheme: what to bring, what to write,
   * where to go, and how much to trust the match.
   *
   * The per-criterion verdicts come from the same `match_schemes()` call the results
   * page uses rather than being recomputed, so the pack can never disagree with the
   * match that led the user here.
   */
  async buildPack(schemeId: string, profile: ApplicantProfile): Promise<ApplicationPack> {
    const record = await this.prisma.scheme.findUnique({ where: { id: schemeId } });
    if (!record) {
      throw new NotFoundException(`Scheme ${schemeId} not found`);
    }

    const scheme = toSchemeDto(record);

    // maxFailures is wide so the scheme comes back even when the applicant does not
    // qualify — someone reviewing a near miss still needs the document list.
    const match = await this.matching.match({
      profile,
      maxFailures: 3,
      category: null,
      confirmedOnly: false,
      limit: 200,
    });
    const matched = match.matches.find((candidate) => candidate.id === schemeId);

    const unverifiedCriteria = (matched?.unverifiedCriteria ?? []).map(
      (criterion) => ELIGIBILITY_CRITERION_META[criterion].label,
    );

    return {
      scheme,
      confidence: matchConfidence({
        unverifiedCriteria: matched?.unverifiedCriteria ?? [],
        proxyNote: scheme.proxyNote,
      }),
      proxyWarning: scheme.proxyNote,
      checklist: buildDocumentChecklist(scheme.requiredDocuments, profile),
      prefilled: buildPrefilledFields(profile, scheme),
      unverifiedCriteria,
      applyUrl: scheme.applicationUrl,
      sourceUrl: scheme.sourceUrl,
    };
  }
}

/**
 * The pre-filled summary sheet.
 *
 * Fields the applicant has not given are kept with a null value rather than dropped, so
 * the printed sheet has a labelled blank line to complete by hand at the office. A
 * missing field is a gap to fill in, not something to hide.
 */
function buildPrefilledFields(profile: ApplicantProfile, scheme: SchemeDto): PrefilledField[] {
  return [
    { label: 'Scheme applied for', value: scheme.name, field: null },
    { label: 'Implementing department', value: scheme.ministry, field: null },
    { label: 'Applicant name', value: null, field: null },
    { label: 'Age', value: profile.age === null ? null : `${profile.age} years`, field: 'age' },
    {
      label: 'Gender',
      value: profile.gender === null ? null : GENDER_LABELS[profile.gender],
      field: 'gender',
    },
    {
      label: 'State',
      value: profile.state === null ? null : regionName(profile.state),
      field: 'state',
    },
    { label: 'District', value: profile.district, field: 'district' },
    {
      label: 'Social category',
      value:
        profile.socialCategory === null ? null : SOCIAL_CATEGORY_LABELS[profile.socialCategory],
      field: 'socialCategory',
    },
    {
      label: 'Annual family income',
      value:
        profile.incomeBracket === null ? null : INCOME_BRACKET_BOUNDS[profile.incomeBracket].label,
      field: 'incomeBracket',
    },
    {
      label: 'Occupation',
      value: profile.occupation === null ? null : OCCUPATION_LABELS[profile.occupation],
      field: 'occupation',
    },
    {
      label: 'Land holding',
      value: profile.landHolding === null ? null : `${profile.landHolding} hectares`,
      field: 'landHolding',
    },
    {
      label: 'Currently studying',
      value: profile.isStudent === null ? null : profile.isStudent ? 'Yes' : 'No',
      field: 'isStudent',
    },
    {
      label: 'Disability certificate',
      value: profile.hasDisability === null ? null : profile.hasDisability ? 'Yes' : 'No',
      field: 'hasDisability',
    },
    { label: 'Aadhaar number', value: null, field: null },
    { label: 'Bank account number', value: null, field: null },
    { label: 'Mobile number', value: null, field: null },
  ];
}
