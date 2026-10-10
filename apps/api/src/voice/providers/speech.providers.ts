import type { SttProvider, TtsProvider } from '@sih/shared';

/**
 * Provider seams for speech.
 *
 * Two implementations exist for each, and which one runs is decided at boot from
 * whether `SARVAM_API_KEY` is present. Both interfaces are deliberately tiny: the
 * only thing the rest of the system needs from speech is text in and audio out.
 */

export interface TranscribeInput {
  audio: Buffer;
  mimeType: string;
  /** BCP-47 hint. Providers may ignore it and auto-detect. */
  language: string;
}

export interface TranscribeOutput {
  transcript: string;
  language: string;
}

export interface SpeechToTextProvider {
  readonly name: SttProvider;
  /** False when credentials or an endpoint are missing, so selection can skip it. */
  isAvailable(): boolean;
  transcribe(input: TranscribeInput): Promise<TranscribeOutput>;
}

export interface SynthesizeInput {
  text: string;
  language: string;
}

export interface SynthesizeOutput {
  /** Null means "no server audio" — the caller should use browser SpeechSynthesis. */
  audio: Buffer | null;
  mimeType: string | null;
}

export interface TextToSpeechProvider {
  readonly name: TtsProvider;
  isAvailable(): boolean;
  synthesize(input: SynthesizeInput): Promise<SynthesizeOutput>;
}

export class SpeechProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = 'SpeechProviderError';
  }
}

/** Shared fetch-with-timeout, since every provider needs the same guard. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  provider: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    throw new SpeechProviderError(
      aborted ? `timed out after ${timeoutMs}ms` : `network error: ${(error as Error).message}`,
      provider,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * MediaRecorder reports types like `audio/webm;codecs=opus`; multipart uploads want a
 * plain filename with a matching extension, and some providers sniff the extension
 * rather than the content type.
 */
export function filenameForMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? 'audio/webm';
  const extension =
    {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/wave': 'wav',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/mp4': 'mp4',
      'audio/m4a': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/flac': 'flac',
      'audio/aac': 'aac',
    }[base] ?? 'webm';

  return `speech.${extension}`;
}
