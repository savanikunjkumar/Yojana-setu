'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SUPPORTED_LANGUAGES,
  type ApplicantProfile,
  type MatchResponse,
  type VoiceCapabilities,
} from '@sih/shared';
import {
  ApiError,
  TimeoutError,
  fetchVoiceCapabilities,
  submitVoiceTurn,
  transcribeAudio,
} from '@/lib/api';
import { speak, stopSpeaking } from '@/lib/speech';
import { useRecorder } from '@/lib/use-recorder';

/** The four states the user needs to be able to tell apart at a glance. */
type Phase = 'idle' | 'recording' | 'processing' | 'speaking';

export function VoiceConsole({
  profile,
  language,
  onLanguageChange,
  onProfileChange,
  onMatch,
  onSlowExtraction,
}: {
  profile: ApplicantProfile;
  language: string;
  onLanguageChange: (language: string) => void;
  /** Lifts the merged profile so the typed form shows the same values. */
  onProfileChange: (profile: ApplicantProfile, filled: Array<keyof ApplicantProfile>) => void;
  onMatch: (match: MatchResponse) => void;
  /** Called when interpretation was too slow, so the typed form can take over. */
  onSlowExtraction: (transcript: string) => void;
}) {
  const recorder = useRecorder();
  const [phase, setPhase] = useState<Phase>('idle');
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [transcript, setTranscript] = useState('');
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    fetchVoiceCapabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities(null));
  }, []);

  useEffect(() => stopSpeaking, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setReasoning(null);
    stopSpeaking();
    await recorder.start();
    setPhase('recording');
  }, [recorder]);

  const stopAndTranscribe = useCallback(async () => {
    setPhase('processing');

    try {
      const recording = await recorder.stop();
      if (!recording) {
        setError('Nothing was recorded. Hold the button while you speak.');
        setPhase('idle');
        return;
      }

      const result = await transcribeAudio({
        audioBase64: recording.audioBase64,
        mimeType: recording.mimeType,
        language,
      });

      // Deliberately stops here rather than matching straight away: the transcript is
      // editable first, so a mis-hearing is recoverable instead of silently wrong.
      setTranscript(result.transcript);
      setPhase('idle');
      transcriptRef.current?.focus();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not transcribe that.');
      setPhase('idle');
    }
  }, [language, recorder]);

  /**
   * The conversational loop: interpret the transcript, re-match, then speak the single
   * highest-value follow-up that the matcher itself nominated.
   */
  const runTurn = useCallback(async () => {
    const text = transcript.trim();
    if (!text) return;

    setPhase('processing');
    setError(null);

    try {
      const result = await submitVoiceTurn({ transcript: text, profile, language });

      onProfileChange(result.profile, result.filledFields);
      onMatch(result.match);
      setReasoning(result.reasoning || null);
      // Cleared only on success: a failed turn must leave the words on screen so the user
      // can retry or hand them to the form instead of speaking again.
      setTranscript('');

      // A status question is answered instead of continuing the narrowing loop.
      if (result.statusSummary) {
        setLastQuestion(result.statusSummary);
        setPhase('speaking');
        await speak(result.statusSummary, language);
        setPhase('idle');
        return;
      }

      const question = result.match.nextQuestion;
      if (question) {
        const spoken = language.startsWith('hi') ? question.questionHi : question.question;
        setLastQuestion(spoken);
        setPhase('speaking');
        await speak(spoken, language);
      } else {
        setLastQuestion(null);
      }

      setPhase('idle');
    } catch (caught) {
      // A timeout is not a dead end. The transcript is already correct and already on
      // screen, so hand it to the typed form and let the user carry on there rather than
      // leaving them watching a spinner — the interpretation is the only part that failed.
      if (caught instanceof TimeoutError) {
        onSlowExtraction(text);
        setError(
          'That is taking longer than it should. Your words are saved below — fill in what you can ' +
            'in the form and press “Find my schemes”.',
        );
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not interpret that.');
      }
      setPhase('idle');
    }
  }, [language, onMatch, onProfileChange, onSlowExtraction, profile, transcript]);

  const micDisabled =
    recorder.state === 'unsupported' ||
    capabilities?.speechInputAvailable === false ||
    phase === 'processing' ||
    phase === 'speaking';

  return (
    <section aria-labelledby="voice-heading" className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="voice-heading" className="font-display text-lg font-bold text-ink">
          Speak instead of typing
        </h2>
        <PhaseBadge phase={phase} />
      </div>

      <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">
        Say whatever you like, in your own language. Anything you don&apos;t mention stays blank —
        it is never guessed.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-4">
        <button
          type="button"
          onClick={phase === 'recording' ? stopAndTranscribe : startRecording}
          disabled={micDisabled}
          aria-pressed={phase === 'recording'}
          className={clsx(
            'grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 transition-colors',
            'disabled:cursor-not-allowed disabled:border-rule disabled:text-ink-faint',
            phase === 'recording'
              ? 'animate-pulse-ring border-maroon bg-maroon text-paper'
              : 'border-ink text-ink hover:border-saffron hover:text-saffron',
          )}
        >
          {phase === 'recording' ? <StopIcon /> : <MicIcon />}
          <span className="sr-only">
            {phase === 'recording' ? 'Stop recording' : 'Start recording'}
          </span>
        </button>

        <div className="min-w-[12rem] flex-1">
          <p className="font-sans text-sm font-semibold text-ink">
            {phase === 'recording'
              ? `Listening… ${(recorder.elapsedMs / 1000).toFixed(1)}s`
              : phase === 'processing'
                ? 'Working on it…'
                : phase === 'speaking'
                  ? 'Speaking…'
                  : 'Tap to speak'}
          </p>
          {phase === 'recording' && (
            <button
              type="button"
              onClick={() => {
                recorder.cancel();
                setPhase('idle');
              }}
              className="mt-1 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint underline decoration-rule decoration-2 underline-offset-4 hover:text-maroon"
            >
              Discard
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="label-caps" htmlFor="voice-language">
            Language
          </label>
          <select
            id="voice-language"
            className="field w-auto min-w-[9rem]"
            value={language}
            onChange={(event) => onLanguageChange(event.target.value)}
          >
            {SUPPORTED_LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.nativeName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(recorder.error || error) && (
        <p className="mt-4 border-l-2 border-maroon bg-maroon/[0.05] py-2 pl-3 font-sans text-sm text-ink-soft">
          {recorder.error ?? error}{' '}
          <span className="text-ink-faint">The form below always works.</span>
        </p>
      )}

      {recorder.state === 'unsupported' && (
        <p className="mt-4 border-l-2 border-amber bg-amber/[0.05] py-2 pl-3 font-sans text-sm text-ink-soft">
          This browser cannot record audio. Use the form below instead.
        </p>
      )}

      {capabilities?.speechInputAvailable === false && (
        <p className="mt-4 border-l-2 border-amber bg-amber/[0.05] py-2 pl-3 font-sans text-sm text-ink-soft">
          Speech recognition is not configured on the server, so the microphone is off. Everything
          else works — including the spoken questions.
        </p>
      )}

      <div className="mt-5">
        <label className="label-caps" htmlFor="transcript">
          What we heard — correct it before matching
        </label>
        <textarea
          id="transcript"
          ref={transcriptRef}
          rows={3}
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          placeholder="Your words appear here. You can edit or just type directly."
          className="field mt-1 resize-y border-2 border-rule px-2 py-2 focus:border-saffron"
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={runTurn}
            disabled={!transcript.trim() || phase === 'processing' || phase === 'speaking'}
            className="min-h-[3rem] border-2 border-ink bg-ink px-5 font-sans font-semibold text-paper transition-colors hover:border-saffron hover:bg-saffron disabled:opacity-50"
          >
            Use this and find schemes
          </button>
          {transcript.trim() && (
            <button
              type="button"
              onClick={() => setTranscript('')}
              className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint underline decoration-rule decoration-2 underline-offset-4 hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {reasoning && (
        <p className="mt-4 border-l-2 border-teal bg-teal/[0.04] py-2 pl-3 font-sans text-sm text-ink-soft">
          <span className="font-semibold text-teal">Understood as</span> {reasoning}
        </p>
      )}

      {lastQuestion && (
        <div className="mt-4 border-t border-rule pt-3">
          <p className="label-caps">Asked you</p>
          <p className="mt-1 font-display text-base text-ink">{lastQuestion}</p>
          <button
            type="button"
            onClick={startRecording}
            disabled={micDisabled}
            className="mt-2 min-h-[2.75rem] border-2 border-saffron px-4 font-sans text-sm font-semibold text-saffron transition-colors hover:bg-saffron hover:text-paper disabled:opacity-50"
          >
            Answer this
          </button>
        </div>
      )}

      {capabilities && (
        <p className="mt-5 border-t border-rule pt-3 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-faint">
          speech-to-text: {capabilities.stt} · speech: {capabilities.tts}
        </p>
      )}
    </section>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const styles: Record<Phase, string> = {
    idle: 'border-rule text-ink-faint',
    recording: 'border-maroon text-maroon',
    processing: 'border-amber text-amber',
    speaking: 'border-teal text-teal',
  };

  return (
    <span
      aria-live="polite"
      className={clsx(
        'border px-2 py-1 font-mono text-[0.625rem] uppercase tracking-[0.16em]',
        styles[phase],
      )}
    >
      {phase}
    </span>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      className="h-7 w-7"
    >
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}
