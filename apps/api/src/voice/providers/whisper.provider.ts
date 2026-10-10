import { Logger } from '@nestjs/common';
import type { SttProvider, TtsProvider } from '@sih/shared';
import {
  fetchWithTimeout,
  filenameForMimeType,
  SpeechProviderError,
  type SpeechToTextProvider,
  type SynthesizeInput,
  type SynthesizeOutput,
  type TextToSpeechProvider,
  type TranscribeInput,
  type TranscribeOutput,
} from './speech.providers';

const TIMEOUT_MS = 60_000;

/**
 * Whisper over the OpenAI-compatible `/audio/transcriptions` endpoint.
 *
 * Defaults to the same base URL and key as the LLM client, because the Groq account
 * already configured for scheme normalisation also serves `whisper-large-v3-turbo`.
 * That makes the fallback path free of extra setup: no second key, no local model
 * download, no separate service to run. Point `WHISPER_BASE_URL` at whisper.cpp,
 * faster-whisper or LM Studio instead and nothing else changes.
 */
export class WhisperSpeechToText implements SpeechToTextProvider {
  readonly name: SttProvider = 'whisper';
  private readonly logger = new Logger(WhisperSpeechToText.name);

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly model: string,
  ) {}

  isAvailable(): boolean {
    // A local endpoint needs no key; a hosted one does.
    return Boolean(this.baseUrl) && (Boolean(this.apiKey) || this.isLocalEndpoint());
  }

  private isLocalEndpoint(): boolean {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(this.baseUrl);
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
      filenameForMimeType(input.mimeType),
    );
    form.append('model', this.model);
    // Whisper wants a bare ISO-639-1 code, not a BCP-47 tag.
    form.append('language', input.language.split('-')[0] ?? 'hi');
    form.append('response_format', 'json');

    const response = await fetchWithTimeout(
      `${this.baseUrl.replace(/\/$/, '')}/audio/transcriptions`,
      {
        method: 'POST',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        body: form,
      },
      TIMEOUT_MS,
      this.name,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new SpeechProviderError(`HTTP ${response.status}: ${body.slice(0, 200)}`, this.name);
    }

    const payload = (await response.json()) as { text?: string; language?: string };
    const transcript = payload.text?.trim();

    if (!transcript) {
      throw new SpeechProviderError('no text in response', this.name);
    }

    this.logger.debug(`Whisper transcribed ${input.audio.length} bytes via ${this.model}`);
    return { transcript, language: payload.language ?? input.language };
  }
}

/**
 * The zero-cost text-to-speech path: return no audio and let the browser speak.
 *
 * `SpeechSynthesis` is built into every modern browser, needs no key and no network,
 * and its Indian-language voices are adequate for reading a scheme name aloud. Being
 * a real provider rather than a special case keeps the selection logic uniform — the
 * service always has a TTS provider, so nothing downstream handles "TTS is missing".
 */
export class BrowserTextToSpeech implements TextToSpeechProvider {
  readonly name: TtsProvider = 'browser';

  isAvailable(): boolean {
    return true;
  }

  async synthesize(_input: SynthesizeInput): Promise<SynthesizeOutput> {
    return { audio: null, mimeType: null };
  }
}
