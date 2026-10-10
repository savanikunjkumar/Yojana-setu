import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  diffProfiles,
  type SpeakRequest,
  type SpeakResult,
  type TranscribeRequest,
  type TranscriptionResult,
  type VoiceCapabilities,
  type VoiceTurnRequest,
  type VoiceTurnResult,
  SUPPORTED_LANGUAGES,
} from '@sih/shared';
import { StatusTrackingService } from '../assistance/status-tracking.service';
import { MatchingService } from '../matching/matching.service';
import { ProfileExtractionService } from './profile-extraction.service';
import { SarvamSpeechToText, SarvamTextToSpeech } from './providers/sarvam.provider';
import type { SpeechToTextProvider, TextToSpeechProvider } from './providers/speech.providers';
import { BrowserTextToSpeech, WhisperSpeechToText } from './providers/whisper.provider';

/**
 * Orchestrates the voice layer.
 *
 * Provider choice happens here and nowhere else: Sarvam when its key is present,
 * Whisper otherwise, and browser speech synthesis whenever server-side audio is
 * unavailable. Every path has a working fallback, so the feature degrades in quality
 * rather than breaking — and the typed form remains untouched regardless, which is
 * what makes voice an enhancement instead of a dependency.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  private readonly sttChain: SpeechToTextProvider[];
  private readonly ttsChain: TextToSpeechProvider[];

  constructor(
    private readonly matching: MatchingService,
    private readonly extraction: ProfileExtractionService,
    private readonly tracking: StatusTrackingService,
  ) {
    const sarvamKey = process.env.SARVAM_API_KEY?.trim() || undefined;

    // Ordered by preference. Sarvam first because Saaras is trained on Indian accents
    // and code-mixed speech, which is how the intended users actually talk.
    this.sttChain = [
      new SarvamSpeechToText(sarvamKey),
      new WhisperSpeechToText(
        process.env.WHISPER_BASE_URL ?? process.env.LLM_BASE_URL ?? '',
        process.env.WHISPER_API_KEY ?? process.env.LLM_API_KEY,
        process.env.WHISPER_MODEL ?? 'whisper-large-v3-turbo',
      ),
    ];

    this.ttsChain = [new SarvamTextToSpeech(sarvamKey), new BrowserTextToSpeech()];

    const capabilities = this.capabilities();
    this.logger.log(
      `Voice layer: STT=${capabilities.stt}, TTS=${capabilities.tts}` +
        (capabilities.speechInputAvailable ? '' : ' (speech input unavailable)'),
    );
  }

  capabilities(): VoiceCapabilities {
    const stt = this.sttChain.find((provider) => provider.isAvailable());
    const tts = this.ttsChain.find((provider) => provider.isAvailable());
    const notes: string[] = [];

    if (!process.env.SARVAM_API_KEY?.trim()) {
      notes.push(
        'SARVAM_API_KEY is not set, so Indian-language speech falls back to Whisper and browser speech synthesis.',
      );
    }
    if (!stt) {
      notes.push(
        'No speech-to-text backend is reachable. The typed form remains fully functional.',
      );
    }

    return {
      stt: stt?.name ?? 'none',
      tts: tts?.name ?? 'browser',
      speechInputAvailable: Boolean(stt),
      languages: SUPPORTED_LANGUAGES.map((language) => language.code),
      notes,
    };
  }

  /**
   * Transcribes an utterance, walking down the provider chain on failure.
   *
   * A configured provider that errors at request time is treated like an unavailable
   * one, because from the user's point of view they are the same thing: Sarvam being
   * rate-limited mid-demo should quietly become Whisper, not a dead microphone.
   */
  async transcribe(request: TranscribeRequest): Promise<TranscriptionResult> {
    const audio = Buffer.from(request.audioBase64, 'base64');
    if (audio.length < 512) {
      throw new ServiceUnavailableException(
        'That recording was too short to transcribe — try holding the button a little longer.',
      );
    }

    const startedAt = Date.now();
    const failures: string[] = [];

    for (const provider of this.sttChain) {
      if (!provider.isAvailable()) continue;

      try {
        const result = await provider.transcribe({
          audio,
          mimeType: request.mimeType,
          language: request.language,
        });

        return {
          transcript: result.transcript,
          language: result.language,
          provider: provider.name,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        const message = (error as Error).message;
        failures.push(`${provider.name}: ${message}`);
        this.logger.warn(`STT provider ${provider.name} failed, trying next — ${message}`);
      }
    }

    throw new ServiceUnavailableException({
      message:
        'Speech recognition is unavailable. You can type your answers instead — the form works exactly the same.',
      failures,
    });
  }

  /** Synthesizes speech, or signals that the browser should do it. */
  async speak(request: SpeakRequest): Promise<SpeakResult> {
    for (const provider of this.ttsChain) {
      if (!provider.isAvailable()) continue;

      try {
        const result = await provider.synthesize({
          text: request.text,
          language: request.language,
        });

        return {
          audioBase64: result.audio ? result.audio.toString('base64') : null,
          mimeType: result.mimeType,
          provider: provider.name,
          text: request.text,
          language: request.language,
        };
      } catch (error) {
        this.logger.warn(
          `TTS provider ${provider.name} failed, falling back — ${(error as Error).message}`,
        );
      }
    }

    // BrowserTextToSpeech never throws, so this is unreachable in practice; returning
    // the browser shape keeps the contract total rather than relying on that.
    return {
      audioBase64: null,
      mimeType: null,
      provider: 'browser',
      text: request.text,
      language: request.language,
    };
  }

  /**
   * One turn of the conversation: interpret what was said, merge it into the profile,
   * and re-run the match.
   *
   * The returned match carries `nextQuestion`, which is what the client speaks to
   * continue the loop. Matching is untouched — the same `match_schemes()` call the
   * typed form makes, with the same PASS/FAIL/UNKNOWN verdicts.
   */
  async turn(request: VoiceTurnRequest): Promise<VoiceTurnResult> {
    if (!this.extraction.isAvailable) {
      throw new ServiceUnavailableException(
        'Profile extraction needs LLM_API_KEY in .env. Until then, use the typed form.',
      );
    }

    const extracted = await this.extraction.extract({
      transcript: request.transcript,
      existing: request.profile,
      language: request.language,
    });

    const match = await this.matching.match({
      profile: extracted.profile,
      maxFailures: request.maxFailures,
      category: null,
      confirmedOnly: false,
      limit: 50,
    });

    const filledFields = diffProfiles(request.profile, extracted.profile);

    // "meri applications ka kya status hai" is a different question from "here are my
    // details", and it is detected by the same LLM call rather than a second one. The
    // summary is plain prose; the client speaks it through the existing TTS chain.
    let statusSummary: string | null = null;
    if (extracted.intent === 'ASK_APPLICATION_STATUS') {
      statusSummary = request.applicantId
        ? await this.tracking.spokenSummary(request.applicantId, request.language)
        : this.noSavedProfileMessage(request.language);
    }

    this.logger.debug(
      `Turn intent=${extracted.intent} filled [${filledFields.join(', ') || 'nothing'}] → ` +
        `${match.eligibleCount} eligible, next question: ${match.nextQuestion?.field ?? 'none'}`,
    );

    return {
      profile: extracted.profile,
      filledFields,
      unstatedFields: extracted.unstatedFields,
      match,
      reasoning: extracted.reasoning,
      statusSummary,
    };
  }

  /** Asked about status without a saved profile — say what to do, do not error. */
  private noSavedProfileMessage(language: string): string {
    return language.startsWith('hi')
      ? 'आपने अभी कोई आवेदन इस ऐप में सहेजा नहीं है। पहले अपनी जानकारी सहेजें, फिर आवेदन ट्रैक कर सकते हैं।'
      : 'You have not saved any applications here yet. Save your details first, then you can track applications.';
  }
}
