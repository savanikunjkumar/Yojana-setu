import type {
  ApplicantProfile,
  ApplicationDashboard,
  ApplicationPack,
  ApplicationStatus,
  MatchRequestInput,
  MatchResponse,
  Paginated,
  SchemeDto,
  SpeakResult,
  TrackedApplication,
  TranscriptionResult,
  SchemeStats,
  VoiceCapabilities,
  VoiceTurnResult,
} from '@sih/shared';
import {
  OFFLINE_MODE,
  offlineMatch,
  offlinePack,
  offlineStats,
  offlineTranscript,
  offlineVoiceTurn,
} from './demo-mode';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Raised when a request exceeded its budget, so callers can fall back rather than fail. */
export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Request took longer than ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  let response: Response;

  // A timeout here is a product decision, not a network setting: past a few seconds the
  // right move is to show the user their transcript in the form rather than keep spinning.
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError' && timeoutMs) {
      throw new TimeoutError(timeoutMs);
    }
    // Distinguishable from a 4xx/5xx: almost always means the API isn't running.
    throw new ApiError(`Could not reach the API at ${API_BASE_URL}`, 0);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      issues?: Array<{ path: string; message: string }>;
    } | null;

    throw new ApiError(
      body?.message ?? `Request to ${path} failed`,
      response.status,
      body?.issues ?? [],
    );
  }

  return (await response.json()) as T;
}

/**
 * Simulates the latency of a real call in offline mode.
 *
 * Not cosmetic: returning instantly makes the loading states untestable and makes the demo
 * look fake. A short delay keeps every progress indicator on the same code path it uses
 * online.
 */
function offline<T>(value: T, ms = 240): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Runs the matcher. The profile may be as incomplete as the user has answered. */
export function matchSchemes(
  profile: ApplicantProfile,
  options: Omit<MatchRequestInput, 'profile'> = {},
): Promise<MatchResponse> {
  if (OFFLINE_MODE) return offline(offlineMatch(profile));

  return request<MatchResponse>('/matching', {
    method: 'POST',
    body: JSON.stringify({ profile, ...options } satisfies MatchRequestInput),
  });
}

export function listSchemes(params: Record<string, string> = {}): Promise<Paginated<SchemeDto>> {
  const query = new URLSearchParams(params).toString();
  return request<Paginated<SchemeDto>>(`/schemes${query ? `?${query}` : ''}`);
}

// --- Voice ------------------------------------------------------------------

/**
 * Corpus statistics for the data page.
 *
 * Cheap enough to fetch on demand — it is one aggregate query — so it is deliberately not
 * cached client-side; a stale scheme count on the page that exists to be honest about the
 * data would be the wrong trade.
 */
export function fetchSchemeStats(): Promise<SchemeStats> {
  if (OFFLINE_MODE) return offline(offlineStats());

  return request<SchemeStats>('/schemes/stats');
}

/** What the server can do. Called once on load so the UI never offers a dead mic. */
export function fetchVoiceCapabilities(): Promise<VoiceCapabilities> {
  if (OFFLINE_MODE) {
    return offline({
      stt: 'none' as const,
      tts: 'browser' as const,
      // The microphone is honestly reported as unavailable offline; the recorded transcript
      // is offered instead, rather than pretending to listen.
      speechInputAvailable: false,
      languages: ['hi-IN', 'en-IN'],
      notes: ['Offline demo mode: speech is replayed from a recording, nothing is sent anywhere.'],
    });
  }

  return request<VoiceCapabilities>('/voice/capabilities');
}

export function transcribeAudio(input: {
  audioBase64: string;
  mimeType: string;
  language: string;
}): Promise<TranscriptionResult> {
  if (OFFLINE_MODE) {
    return offline({
      transcript: offlineTranscript(),
      language: input.language,
      provider: 'none' as const,
      durationMs: 0,
    });
  }

  return request<TranscriptionResult>('/voice/transcribe', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * One conversational turn. The transcript is sent separately from the audio so the
 * user's corrections are what gets interpreted.
 */
/**
 * Budget for one conversational turn.
 *
 * Slightly above the server's own 8s extraction timeout so the server usually gets to
 * answer (or fail cleanly) first; this is the backstop for the server being unreachable or
 * wedged. Either way the user sees their transcript in the form within ten seconds.
 */
export const VOICE_TURN_TIMEOUT_MS = 9_000;

export function submitVoiceTurn(input: {
  transcript: string;
  profile: ApplicantProfile;
  language: string;
  maxFailures?: number;
  applicantId?: string | null;
}): Promise<VoiceTurnResult> {
  if (OFFLINE_MODE) return offline(offlineVoiceTurn(input.profile), 500);

  return request<VoiceTurnResult>('/voice/turn', {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: VOICE_TURN_TIMEOUT_MS,
  });
}

export function synthesizeSpeech(input: { text: string; language: string }): Promise<SpeakResult> {
  return request<SpeakResult>('/voice/speak', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Application assistance and status tracking ------------------------------

export function fetchApplicationPack(schemeId: string, profile: unknown): Promise<ApplicationPack> {
  if (OFFLINE_MODE) return offline(offlinePack(schemeId, profile as ApplicantProfile), 350);

  return request<ApplicationPack>('/assistance/pack', {
    method: 'POST',
    body: JSON.stringify({ schemeId, profile }),
  });
}

export function fetchApplicationDashboard(applicantId: string): Promise<ApplicationDashboard> {
  return request<ApplicationDashboard>(`/assistance/applications/${applicantId}`);
}

export function updateApplicationStatus(
  applicationId: string,
  input: { status: ApplicationStatus; notes?: string | null },
): Promise<TrackedApplication> {
  return request<TrackedApplication>(`/assistance/applications/${applicationId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Starts tracking an application. Uses the existing applications endpoint. */
export function startTrackingApplication(input: {
  applicantId: string;
  schemeId: string;
}): Promise<{ id: string }> {
  return request<{ id: string }>('/applications', {
    method: 'POST',
    body: JSON.stringify({ ...input, status: 'IN_PROGRESS' }),
  });
}

export function saveApplicantProfile(profile: ApplicantProfile): Promise<{ id: string }> {
  return request<{ id: string }>('/applicants', {
    method: 'POST',
    body: JSON.stringify(profile),
  });
}

export { API_BASE_URL };
