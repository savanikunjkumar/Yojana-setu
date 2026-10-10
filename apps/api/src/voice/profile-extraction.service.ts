import { Injectable, Logger } from '@nestjs/common';
import {
  applicantProfileSchema,
  GENDERS,
  INCOME_BRACKETS,
  mergeProfiles,
  OCCUPATIONS,
  resolveRegionCode,
  SOCIAL_CATEGORIES,
  type ApplicantProfile,
} from '@sih/shared';
import { completeJson, llmSettingsFromEnv, type LlmSettings } from '../llm/llm.client';

/**
 * What the speaker wanted. Detected in the same call that extracts profile fields, so
 * asking about status costs no extra LLM round trip and no second client.
 */
export const VOICE_INTENTS = ['PROVIDE_DETAILS', 'ASK_APPLICATION_STATUS'] as const;
export type VoiceIntent = (typeof VOICE_INTENTS)[number];

export interface ExtractionOutcome {
  profile: ApplicantProfile;
  unstatedFields: Array<keyof ApplicantProfile>;
  reasoning: string;
  intent: VoiceIntent;
}

/**
 * JSON Schema for one utterance.
 *
 * Every field is nullable and every field is required, so the model must take a
 * position on each one — "not stated" is an explicit `null` rather than a missing key
 * that could be mistaken for an oversight.
 */
/**
 * Kept deliberately lean: at ~500 tokens the original schema was larger than the prompt
 * itself, and every token is paid for on each turn.
 *
 * Two economies worth noting. `state` is a plain string rather than an enum of all 36 ISO
 * codes — `resolveRegionCode()` already normalises whatever comes back, including a plain
 * "Uttar Pradesh", so spending ~70 tokens per call restating the list buys nothing.
 * Descriptions survive only where they carry a rule that changes the output; the rest of
 * the guidance lives in the system prompt, where it is stated once.
 */
export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'age',
    'gender',
    'incomeBracket',
    'occupation',
    'state',
    'district',
    'socialCategory',
    'landHoldingHectares',
    'isStudent',
    'hasDisability',
    'reasoning',
    'intent',
  ],
  properties: {
    intent: { type: 'string', enum: ['PROVIDE_DETAILS', 'ASK_APPLICATION_STATUS'] },
    age: { type: ['integer', 'null'] },
    gender: { type: ['string', 'null'], enum: [...GENDERS, null] },
    incomeBracket: {
      type: ['string', 'null'],
      enum: [...INCOME_BRACKETS, null],
      description: 'Only from a stated figure. "income is low" is not a bracket.',
    },
    occupation: { type: ['string', 'null'], enum: [...OCCUPATIONS, null] },
    state: { type: ['string', 'null'], description: 'ISO 3166-2:IN code, e.g. IN-UP' },
    district: { type: ['string', 'null'] },
    socialCategory: { type: ['string', 'null'], enum: [...SOCIAL_CATEGORIES, null] },
    landHoldingHectares: { type: ['number', 'null'], description: 'Hectares' },
    isStudent: { type: ['boolean', 'null'] },
    hasDisability: { type: ['boolean', 'null'] },
    reasoning: { type: 'string', description: 'One short sentence: what was heard, what was left null' },
  },
};

/**
 * Trimmed to roughly half its original length, keeping every rule that changes output and
 * cutting the prose that only explained *why*. The reasoning behind the rules belongs in
 * this comment, where it costs nothing per call:
 *
 * A null is not a failure. Downstream it becomes UNKNOWN, and the matcher treats an unknown
 * criterion as still-possible rather than as a rejection, then asks about it. A guess is
 * silently wrong forever — guess an income bracket too high and a citizen never sees a
 * scheme they are entitled to. Hence "never guess" is stated first and stated bluntly.
 *
 * The worked example survived the trim because it is the single most effective part of the
 * prompt: it covers two traps at once (someone else's situation, and a vague quantity) and
 * removing it caused measurable regressions in testing.
 */
export const SYSTEM_PROMPT = `Turn what an Indian citizen said into structured profile fields.
They may speak Hindi, English, a mix, or another Indian language.

RULE: if the speaker did not clearly state a field, return null. Never infer or estimate.
A guess that is wrong hides a scheme they are entitled to; a null just gets asked about.

- Vague quantities are not values: "income kam hai", "thodi zameen hai", "I am poor" → null.
  Only a stated figure or range maps to a bracket.
- Statements about other people do not describe the speaker.
- An occupation implies nothing else: a farmer need not own land.
- Never derive one field from another (no age from "retired", no category from a name).
- landHoldingHectares is in hectares (1 acre = 0.404686 ha). Unclear unit → null.
- state is an ISO 3166-2:IN code; district is free text.
- intent is ASK_APPLICATION_STATUS only when they ask about applications already made.

EXAMPLE
"mera beta college jaa raha hai aur ghar ki income kam hai, main UP se hoon"
→ state "IN-UP", everything else null. The college is the son's; "income kam hai" gives no figure.

Answer only about this utterance; earlier turns are merged by the caller.`;

@Injectable()
export class ProfileExtractionService {
  private readonly logger = new Logger(ProfileExtractionService.name);

  /**
   * Voice extraction reads its own `VOICE_LLM_*` variables, falling back to `LLM_*`.
   *
   * The default is a non-reasoning model on purpose. `gpt-oss-*` are reasoning models that
   * emit chain-of-thought before answering — measured at 278 completion tokens against 127
   * for llama-3.3-70b on the same task — and, because Groq's limits are per model, they also
   * share their token budget with the scraper. A background scrape starving the interactive
   * path is what turned a voice turn into 74 seconds.
   *
   * The timeout is short for the same reason: this sits in front of a person waiting to be
   * answered, so failing fast and falling back beats a long, silent retry.
   */
  private readonly settings: LlmSettings = (() => {
    const loaded = llmSettingsFromEnv(process.env, {
      prefix: 'VOICE_',
      defaultModel: 'llama-3.3-70b-versatile',
      defaultTimeoutMs: 8_000,
    });

    // The configured timeout is the budget for the WHOLE turn, not for each attempt.
    //
    // Without this the two differ sharply: a 429 makes the client honour the provider's
    // retry-after, and a turn measured 11.7 s while every individual attempt stayed inside
    // its 8 s timeout. The browser gives up at 9 s regardless, so anything past that is work
    // nobody is waiting for any more — and worse, it spends rate-limit budget the *next*
    // turn needs, which is how one slow turn becomes several.
    return { ...loaded, deadlineMs: loaded.timeoutMs };
  })();

  get isAvailable(): boolean {
    return Boolean(this.settings.apiKey);
  }

  /**
   * Extracts fields from one utterance and merges them into the running profile.
   *
   * Reuses the same `completeJson` client as the scraper's eligibility normaliser —
   * one LLM client, one place where provider quirks and retries are handled.
   */
  async extract(input: {
    transcript: string;
    existing: ApplicantProfile;
    language: string;
  }): Promise<ExtractionOutcome> {
    const user = [
      `Language hint: ${input.language}`,
      '',
      'Fields already known from earlier turns (do not repeat them unless this utterance corrects them):',
      describeKnown(input.existing),
      '',
      'The person just said:',
      input.transcript,
    ].join('\n');

    const payload = await completeJson(
      {
        system: SYSTEM_PROMPT,
        user,
        schemaName: 'applicant_profile_extraction',
        schema: EXTRACTION_SCHEMA,
      },
      this.settings,
    );

    const candidate = this.toProfilePatch(payload);

    // Validate the patch on its own before merging, so a bad value is rejected rather
    // than poisoning a profile that was previously valid.
    const parsed = applicantProfileSchema.partial().safeParse(candidate);
    if (!parsed.success) {
      this.logger.warn(
        `Extraction produced an invalid patch, ignoring it: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
      return {
        profile: input.existing,
        unstatedFields: [],
        reasoning: 'Could not read any usable field from that; please try rephrasing.',
        intent: 'PROVIDE_DETAILS',
      };
    }

    const profile = mergeProfiles(input.existing, parsed.data);
    const unstatedFields = (Object.keys(candidate) as Array<keyof ApplicantProfile>).filter(
      (field) => candidate[field] === null,
    );

    return {
      profile,
      unstatedFields,
      reasoning: typeof payload.reasoning === 'string' ? payload.reasoning : '',
      intent:
        payload.intent === 'ASK_APPLICATION_STATUS' ? 'ASK_APPLICATION_STATUS' : 'PROVIDE_DETAILS',
    };
  }

  /**
   * Maps the model's response onto profile fields.
   *
   * `state` gets a second pass through `resolveRegionCode` because a model asked for
   * an ISO code will occasionally answer "Uttar Pradesh" anyway — especially in the
   * JSON-object fallback mode, where the enum is only a prompt suggestion.
   */
  private toProfilePatch(payload: Record<string, unknown>): Partial<ApplicantProfile> {
    const state =
      typeof payload.state === 'string' && payload.state.trim()
        ? (resolveRegionCode(payload.state) ?? null)
        : null;

    return {
      age: numberOrNull(payload.age),
      gender: enumOrNull(payload.gender, GENDERS),
      incomeBracket: enumOrNull(payload.incomeBracket, INCOME_BRACKETS),
      occupation: enumOrNull(payload.occupation, OCCUPATIONS),
      state,
      district:
        typeof payload.district === 'string' && payload.district.trim()
          ? payload.district.trim()
          : null,
      socialCategory: enumOrNull(payload.socialCategory, SOCIAL_CATEGORIES),
      landHolding: numberOrNull(payload.landHoldingHectares),
      isStudent: typeof payload.isStudent === 'boolean' ? payload.isStudent : null,
      hasDisability: typeof payload.hasDisability === 'boolean' ? payload.hasDisability : null,
    };
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function enumOrNull<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : null;
}

function describeKnown(profile: ApplicantProfile): string {
  const known = Object.entries(profile)
    .filter(([, value]) => value !== null)
    .map(([field, value]) => `  ${field}: ${String(value)}`);

  return known.length > 0 ? known.join('\n') : '  (nothing known yet)';
}
