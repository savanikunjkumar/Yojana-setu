import { GENDERS, OCCUPATIONS, REGION_CODES, SOCIAL_CATEGORIES } from '@sih/shared';
import { completeJson, LlmError, type LlmSettings } from '../../src/llm/llm.client';
import type { LlmConfig } from './config';

/** What the model is asked to return: the rule, plus review metadata we strip off. */
export interface LlmExtraction {
  rule: Record<string, unknown>;
  usesDeprivationCriteria: boolean;
  notes: string;
}

/**
 * JSON Schema handed to the provider's structured-output mode.
 *
 * Every property is listed in `required` and `additionalProperties` is false,
 * because OpenAI-compatible `strict` mode demands both. Optionality is expressed
 * as a nullable type instead — which lines up exactly with the convention the rest
 * of the system already uses, where `null` on a numeric bound means "unbounded".
 */
const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rule', 'usesDeprivationCriteria', 'notes'],
  properties: {
    rule: {
      type: 'object',
      additionalProperties: false,
      required: [
        'minAge',
        'maxAge',
        'maxAnnualIncome',
        'gender',
        'socialCategory',
        'occupation',
        'states',
        'maxLandHolding',
        'requiresDisability',
        'isStudentOnly',
      ],
      properties: {
        minAge: { type: ['integer', 'null'], description: 'Inclusive minimum age in years' },
        maxAge: { type: ['integer', 'null'], description: 'Inclusive maximum age in years' },
        maxAnnualIncome: {
          type: ['integer', 'null'],
          description: 'Inclusive annual household income cap in rupees',
        },
        gender: { type: 'string', enum: [...GENDERS, '*'] },
        socialCategory: {
          type: 'array',
          items: { type: 'string', enum: [...SOCIAL_CATEGORIES, '*'] },
        },
        occupation: { type: 'array', items: { type: 'string', enum: [...OCCUPATIONS, '*'] } },
        states: { type: 'array', items: { type: 'string', enum: [...REGION_CODES, '*'] } },
        maxLandHolding: {
          type: ['number', 'null'],
          description: 'Inclusive land ceiling in HECTARES',
        },
        requiresDisability: { type: 'boolean' },
        isStudentOnly: { type: 'boolean' },
      },
    },
    usesDeprivationCriteria: {
      type: 'boolean',
      description:
        'True when beneficiaries are selected by SECC/BPL/Antyodaya deprivation criteria rather than a stated income figure',
    },
    notes: {
      type: 'string',
      description: 'One or two sentences on what drove the extraction, for human review',
    },
  },
};

const SYSTEM_PROMPT = `You convert Indian government scheme eligibility prose into a strict JSON rule.

You are transcribing, not advising. Extract only what the text states. A wrong rule
denies a citizen a benefit they are entitled to, so err towards "no restriction"
rather than towards a restriction you inferred.

ENCODING RULES — these are absolute:

1. Numeric bounds (minAge, maxAge, maxAnnualIncome, maxLandHolding) use null to mean
   "the text states no such bound". NEVER invent, estimate, round or infer a number.
   Only emit a number that appears in the text. If the text implies a limit without
   giving a figure, use null.

2. Categorical fields (gender, socialCategory, occupation, states) must ALWAYS be
   present. Use the wildcard "*" for "no restriction":
     - gender: "*" unless the scheme is for one gender only
     - socialCategory / occupation / states: ["*"] unless specific values are named
   Arrays must never be empty. If a restriction applies, list only the named values
   and do not include "*" alongside them.

3. maxLandHolding is in HECTARES. If the text quotes acres, convert (1 acre =
   0.404686 hectares) and say so in notes.

4. states: only list ISO 3166-2:IN codes when the text names specific states. Phrases
   like "permanent resident of the State" or "domicile of the State" do NOT name a
   state — leave states as ["*"]; the caller knows which state administers the scheme.

5. An exclusion is not a cap. "Income tax payers are not eligible" is NOT an income
   ceiling — leave maxAnnualIncome null. Likewise "government employees are excluded"
   is not an occupation restriction, because the scheme is not *for* one occupation.
   Only set occupation when the scheme is restricted TO those occupations.

5a. occupation, specifically:
   - When the text requires an occupation ("the applicant must be a registered
     construction worker"), pick the CLOSEST value in the enum. A construction worker
     is DAILY_WAGE_LABOURER; a cobbler, potter or blacksmith is ARTISAN; a fish vendor
     is FISHERMAN and STREET_VENDOR (list both when a term genuinely spans two).
   - NEVER use "OTHER" as an escape hatch for an occupation you cannot name. "OTHER"
     makes the criterion FAIL for every applicant who selected a real occupation, so it
     excludes exactly the people the scheme is for. If nothing in the enum is close,
     use ["*"] — over-including is recoverable, wrongly excluding is not.
   - When occupations are one of SEVERAL alternative routes in ("any one of the
     following: dropouts, entrepreneurs, artisans…", "farmers and landless persons"),
     the scheme is NOT occupation-restricted. Use ["*"].

6. Set usesDeprivationCriteria true when selection is by SECC 2011, BPL status,
   Antyodaya/AAY, "priority household" or similar deprivation lists rather than a
   stated income figure. In that case still leave maxAnnualIncome null — the caller
   applies its own documented proxy.

7. requiresDisability is true only when a disability is required of the applicant.
   isStudentOnly is true only when current enrolment in study is required.`;

export { LlmError };

/** Normalises one scheme's prose into the loose rule shape, for Zod to validate. */
export async function extractWithLlm(
  input: { name: string; prose: string; tags: string[]; state: string | null },
  config: LlmConfig,
): Promise<LlmExtraction> {
  const user = [
    `Scheme name: ${input.name}`,
    input.tags.length ? `Portal tags: ${input.tags.join(', ')}` : null,
    input.state
      ? `Administered by: ${input.state} (do NOT put this in states[] unless the prose itself names states)`
      : 'Administered centrally',
    '',
    'Eligibility text:',
    input.prose,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const settings: LlmSettings = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  };

  const payload = await completeJson(
    { system: SYSTEM_PROMPT, user, schemaName: 'eligibility_extraction', schema: RESPONSE_SCHEMA },
    settings,
  );

  const rule = payload.rule;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new LlmError('response JSON had no "rule" object', true);
  }

  return {
    rule: rule as Record<string, unknown>,
    usesDeprivationCriteria: payload.usesDeprivationCriteria === true,
    notes: typeof payload.notes === 'string' ? payload.notes : '',
  };
}
