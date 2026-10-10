import { z } from 'zod';
import { applicantProfileSchema, PROFILE_FIELDS, type ApplicantProfile } from './applicant';
import { LANGUAGE_CODES, DEFAULT_LANGUAGE } from './constants/languages';
import { matchRequestSchema, type MatchResponse } from './matching';

/**
 * Contract for the voice layer.
 *
 * The whole feature is an alternative *input method* for `ApplicantProfile` — it adds
 * no new eligibility concepts and no second source of truth. Speech becomes profile
 * fields, and from there everything flows through the matcher that already exists.
 */

export const STT_PROVIDERS = ['sarvam', 'whisper', 'none'] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];

export const TTS_PROVIDERS = ['sarvam', 'browser'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

/**
 * What the server can actually do right now, so the UI can be honest instead of
 * offering a microphone that cannot work. `browser` TTS means "no server audio —
 * use SpeechSynthesis", which costs nothing and always exists.
 */
export interface VoiceCapabilities {
  stt: SttProvider;
  tts: TtsProvider;
  /** False when no speech-to-text backend is reachable; the typed form still works. */
  speechInputAvailable: boolean;
  languages: string[];
  notes: string[];
}

const languageCode = z
  .string()
  .refine((value) => LANGUAGE_CODES.includes(value), { message: 'Unsupported language code' });

export const transcribeRequestSchema = z
  .object({
    /** Base64-encoded audio. Small clips, so JSON beats multipart plumbing. */
    audioBase64: z.string().min(32, 'Audio payload looks empty'),
    /** MIME type reported by MediaRecorder, e.g. `audio/webm;codecs=opus`. */
    mimeType: z.string().min(3).max(120).default('audio/webm'),
    language: languageCode.default(DEFAULT_LANGUAGE),
  })
  .strict();

export type TranscribeRequest = z.infer<typeof transcribeRequestSchema>;

export interface TranscriptionResult {
  transcript: string;
  /** Language the provider believes it heard, which may differ from the request. */
  language: string;
  provider: SttProvider;
  durationMs: number;
}

/**
 * One conversational turn: an (edited) transcript plus the profile built so far.
 *
 * The transcript is a separate field from the audio deliberately — the user gets to
 * correct a mis-transcription before it influences anything.
 */
export const voiceTurnRequestSchema = z
  .object({
    transcript: z.string().trim().min(1).max(4000),
    /** Profile accumulated over previous turns. */
    profile: applicantProfileSchema,
    language: languageCode.default(DEFAULT_LANGUAGE),
    maxFailures: matchRequestSchema.shape.maxFailures,
    /**
     * Needed only to answer "what is the status of my applications". Optional because
     * the matching conversation works perfectly well for someone who has never saved a
     * profile, and requiring an ID up front would break that.
     */
    applicantId: z.string().uuid().nullable().default(null),
  })
  .strict();

export type VoiceTurnRequest = z.infer<typeof voiceTurnRequestSchema>;
export type VoiceTurnRequestInput = z.input<typeof voiceTurnRequestSchema>;

export interface VoiceTurnResult {
  /** Previous profile merged with whatever this utterance stated. */
  profile: ApplicantProfile;
  /** Fields this utterance filled in, for highlighting in the UI. */
  filledFields: Array<keyof ApplicantProfile>;
  /** Fields the model was asked about but the speaker did not state. */
  unstatedFields: Array<keyof ApplicantProfile>;
  /** Match run against the merged profile, carrying its own `nextQuestion`. */
  match: MatchResponse;
  /** Model's short account of what it heard, shown in the demo for transparency. */
  reasoning: string;
  /**
   * Set when the speaker asked about applications they have already made rather than
   * offering new details. The client speaks this instead of the next question, using the
   * same TTS path.
   */
  statusSummary: string | null;
}

export const speakRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(1200),
    language: languageCode.default(DEFAULT_LANGUAGE),
  })
  .strict();

export type SpeakRequest = z.infer<typeof speakRequestSchema>;

export interface SpeakResult {
  /** Base64 audio, or null when the client should use browser SpeechSynthesis. */
  audioBase64: string | null;
  mimeType: string | null;
  provider: TtsProvider;
  /** Echoed back so the browser fallback has something to speak. */
  text: string;
  language: string;
}

/**
 * Fields the extractor may set, in the order they are worth asking about. Mirrors
 * `PROFILE_FIELDS` and excludes `district`, which no eligibility criterion reads.
 */
export const VOICE_EXTRACTABLE_FIELDS = PROFILE_FIELDS;

/** Which profile fields a turn newly populated. */
export function diffProfiles(
  before: ApplicantProfile,
  after: ApplicantProfile,
): Array<keyof ApplicantProfile> {
  return (Object.keys(after) as Array<keyof ApplicantProfile>).filter(
    (field) => before[field] === null && after[field] !== null,
  );
}

/**
 * Merges an utterance's findings into the running profile.
 *
 * A field the speaker did not mention this turn must not erase what they said
 * earlier, so nulls never overwrite. Corrections still work, because a stated value
 * does overwrite — "actually I'm 35, not 25" replaces the age.
 */
export function mergeProfiles(
  existing: ApplicantProfile,
  incoming: Partial<ApplicantProfile>,
): ApplicantProfile {
  const merged: Record<string, unknown> = { ...existing };

  for (const [field, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined) merged[field] = value;
  }

  return applicantProfileSchema.parse(merged);
}
