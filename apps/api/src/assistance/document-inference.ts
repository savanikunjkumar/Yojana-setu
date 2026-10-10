import type { ApplicantProfile, DocumentChecklistItem, DocumentLikelihood } from '@sih/shared';
import { INCOME_BRACKET_BOUNDS, regionName, SOCIAL_CATEGORY_LABELS } from '@sih/shared';

/**
 * Works out which of a scheme's required documents the applicant probably already holds.
 *
 * Deliberately rule-based rather than an LLM call. The mapping from "caste certificate"
 * to "they told us their social category" is a fixed, small relation that does not
 * benefit from a model, and a citizen deciding what to carry to a government office
 * deserves an answer that is identical every time and can be explained in one sentence.
 * It is also free and instant, which matters when this runs for every matched scheme.
 *
 * Every rule states the profile field it reasoned from, so the UI can show its working.
 */

interface DocumentRule {
  /** Matches the document name as published on the portal. */
  pattern: RegExp;
  /** Decides likelihood from the profile, and explains itself. */
  assess: (profile: ApplicantProfile) => Omit<DocumentChecklistItem, 'document'>;
}

/** Documents essentially every Indian adult holds; treated as available by default. */
const UNIVERSAL: RegExp = /\b(aadhaar|aadhar|photograph|passport size|photo|mobile number)\b/i;

const RULES: DocumentRule[] = [
  {
    pattern: UNIVERSAL,
    assess: () => ({
      likelihood: 'LIKELY_HAVE',
      reason: 'Almost every applicant already has this',
      basedOn: null,
    }),
  },
  {
    pattern:
      /\b(caste certificate|category certificate|sc\/st certificate|community certificate)\b/i,
    assess: (profile) =>
      profile.socialCategory === null
        ? {
            likelihood: 'UNKNOWN',
            reason: 'Tell us your category and we can say whether this applies',
            basedOn: 'socialCategory',
          }
        : profile.socialCategory === 'GENERAL'
          ? {
              likelihood: 'NEED_TO_OBTAIN',
              reason: 'General category applicants usually cannot supply this',
              basedOn: 'socialCategory',
            }
          : {
              likelihood: 'LIKELY_HAVE',
              reason: `You told us you are ${SOCIAL_CATEGORY_LABELS[profile.socialCategory]}, so you likely hold this certificate`,
              basedOn: 'socialCategory',
            },
  },
  {
    pattern: /\b(income certificate|income proof|salary slip|income declaration)\b/i,
    assess: (profile) =>
      profile.incomeBracket === null
        ? {
            likelihood: 'UNKNOWN',
            reason: 'Depends on your income — tell us and we can be specific',
            basedOn: 'incomeBracket',
          }
        : {
            likelihood: 'NEED_TO_OBTAIN',
            reason: `Issued by your tehsil or revenue office; you will need one stating ${INCOME_BRACKET_BOUNDS[profile.incomeBracket].label}`,
            basedOn: 'incomeBracket',
          },
  },
  {
    pattern: /\b(land|khatauni|khasra|pattadar|jamabandi|record of rights|7\/12)\b/i,
    assess: (profile) =>
      profile.landHolding === null
        ? {
            likelihood: 'UNKNOWN',
            reason: 'Only needed if you own farm land',
            basedOn: 'landHolding',
          }
        : profile.landHolding > 0
          ? {
              likelihood: 'LIKELY_HAVE',
              reason: `You told us you hold ${profile.landHolding} hectares, so land records exist in your name`,
              basedOn: 'landHolding',
            }
          : {
              likelihood: 'NEED_TO_OBTAIN',
              reason:
                'You told us you hold no land, so you may need a landless certificate instead',
              basedOn: 'landHolding',
            },
  },
  {
    pattern: /\b(disability certificate|udid|divyang)\b/i,
    assess: (profile) =>
      profile.hasDisability === null
        ? {
            likelihood: 'UNKNOWN',
            reason: 'Only needed if you have a disability',
            basedOn: 'hasDisability',
          }
        : profile.hasDisability
          ? {
              likelihood: 'LIKELY_HAVE',
              reason: 'You told us you have a certified disability',
              basedOn: 'hasDisability',
            }
          : {
              likelihood: 'NEED_TO_OBTAIN',
              reason: 'You told us you do not have a disability certificate',
              basedOn: 'hasDisability',
            },
  },
  {
    pattern: /\b(bonafide|school certificate|admission|mark ?sheet|student id|institution)\b/i,
    assess: (profile) =>
      profile.isStudent === null
        ? { likelihood: 'UNKNOWN', reason: 'Only needed if you are studying', basedOn: 'isStudent' }
        : profile.isStudent
          ? {
              likelihood: 'LIKELY_HAVE',
              reason: 'You are studying, so your institution can issue this',
              basedOn: 'isStudent',
            }
          : {
              likelihood: 'NEED_TO_OBTAIN',
              reason: 'You told us you are not currently studying',
              basedOn: 'isStudent',
            },
  },
  {
    pattern: /\b(residence|domicile|address proof|residential certificate|native)\b/i,
    assess: (profile) =>
      profile.state === null
        ? {
            likelihood: 'UNKNOWN',
            reason: 'Tell us your state and we can be specific',
            basedOn: 'state',
          }
        : {
            likelihood: 'LIKELY_HAVE',
            reason: `Your Aadhaar or ration card usually proves ${regionName(profile.state)} residence`,
            basedOn: 'state',
          },
  },
  {
    pattern: /\b(bank|passbook|account|ifsc|cancelled cheque)\b/i,
    assess: () => ({
      likelihood: 'LIKELY_HAVE',
      reason:
        'Benefits are paid by bank transfer, so an account is needed and most applicants have one',
      basedOn: null,
    }),
  },
  {
    pattern: /\b(ration card|bpl card|apl card|antyodaya)\b/i,
    assess: () => ({
      likelihood: 'UNKNOWN',
      reason: 'Depends on your household ration card category',
      basedOn: null,
    }),
  },
  {
    pattern: /\b(birth certificate|age proof|date of birth)\b/i,
    assess: (profile) =>
      profile.age === null
        ? { likelihood: 'UNKNOWN', reason: 'Needed to prove your age', basedOn: 'age' }
        : {
            likelihood: 'LIKELY_HAVE',
            reason: 'Your Aadhaar normally serves as age proof',
            basedOn: 'age',
          },
  },
];

const FALLBACK: Omit<DocumentChecklistItem, 'document'> = {
  likelihood: 'UNKNOWN',
  reason: 'Check the official portal for what this involves',
  basedOn: null,
};

export function buildDocumentChecklist(
  documents: string[],
  profile: ApplicantProfile,
): DocumentChecklistItem[] {
  const checklist = documents.map((document) => {
    const rule = RULES.find((candidate) => candidate.pattern.test(document));
    return { document, ...(rule ? rule.assess(profile) : FALLBACK) };
  });

  // Things to obtain first, then unknowns to resolve, then what they already have.
  const order: Record<DocumentLikelihood, number> = {
    NEED_TO_OBTAIN: 0,
    UNKNOWN: 1,
    LIKELY_HAVE: 2,
  };

  return checklist.sort((a, b) => order[a.likelihood] - order[b.likelihood]);
}
