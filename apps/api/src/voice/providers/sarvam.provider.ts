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

const SARVAM_BASE_URL = 'https://api.sarvam.ai';
const TIMEOUT_MS = 45_000;

/**
 * Sarvam AI — Indian-language speech, and the reason it is the primary provider:
 * Saaras is trained on Indian accents and code-mixed Hindi-English, which is exactly
 * how the intended users speak, and Bulbul produces natural Indian-language audio
 * rather than the flat robotic output of a generic engine.
 *
 * Everything degrades to `isAvailable() === false` when the key is missing. Nothing
 * here throws at construction time, so the API boots and stays fully usable on the
 * typed form with no Sarvam account at all.
 */
export class SarvamSpeechToText implements SpeechToTextProvider {
  readonly name: SttProvider = 'sarvam';
  private readonly logger = new Logger(SarvamSpeechToText.name);

  constructor(private readonly apiKey: string | undefined) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
    if (!this.apiKey) {
      throw new SpeechProviderError('SARVAM_API_KEY is not set', this.name);
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
      filenameForMimeType(input.mimeType),
    );
    // Saaras auto-detects among Indian languages; the hint only nudges it.
    form.append('model', 'saaras:v2');
    form.append('language_code', input.language);

    const response = await fetchWithTimeout(
      `${SARVAM_BASE_URL}/speech-to-text-translate`,
      { method: 'POST', headers: { 'api-subscription-key': this.apiKey }, body: form },
      TIMEOUT_MS,
      this.name,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new SpeechProviderError(`HTTP ${response.status}: ${body.slice(0, 200)}`, this.name);
    }

    const payload = (await response.json()) as {
      transcript?: string;
      language_code?: string;
    };

    const transcript = payload.transcript?.trim();
    if (!transcript) {
      throw new SpeechProviderError('no transcript in response', this.name);
    }

    this.logger.debug(`Saaras transcribed ${input.audio.length} bytes`);
    return { transcript, language: payload.language_code ?? input.language };
  }
}

export class SarvamTextToSpeech implements TextToSpeechProvider {
  readonly name: TtsProvider = 'sarvam';
  private readonly logger = new Logger(SarvamTextToSpeech.name);

  constructor(private readonly apiKey: string | undefined) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    if (!this.apiKey) {
      throw new SpeechProviderError('SARVAM_API_KEY is not set', this.name);
    }

    const response = await fetchWithTimeout(
      `${SARVAM_BASE_URL}/text-to-speech`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-subscription-key': this.apiKey },
        body: JSON.stringify({
          text: input.text,
          target_language_code: input.language,
          model: 'bulbul:v2',
          speaker: 'anushka',
          // Slightly slower than default: these are unfamiliar scheme names being
          // read to someone who may be hearing them for the first time.
          pace: 0.9,
        }),
      },
      TIMEOUT_MS,
      this.name,
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new SpeechProviderError(`HTTP ${response.status}: ${body.slice(0, 200)}`, this.name);
    }

    const payload = (await response.json()) as { audios?: string[] };
    const audio = payload.audios?.[0];

    if (!audio) {
      throw new SpeechProviderError('no audio in response', this.name);
    }

    this.logger.debug(`Bulbul synthesized ${input.text.length} chars`);
    return { audio: Buffer.from(audio, 'base64'), mimeType: 'audio/wav' };
  }
}
