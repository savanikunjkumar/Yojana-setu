'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LANGUAGE,
  EMPTY_PROFILE,
  profileCompleteness,
  type ApplicantProfile,
  type MatchResponse,
} from '@sih/shared';
import { ApiError, matchSchemes } from '@/lib/api';
import { OFFLINE_MODE } from '@/lib/demo-mode';
import { DemoPersonas } from './demo-personas';
import { ErrorBoundary, LoadingPanel } from './error-boundary';
import { NextQuestionBanner } from './next-question';
import { ProfileForm } from './profile-form';
import { ProfilePanel } from './profile-panel';
import { SchemeCard } from './scheme-card';
import { VoiceConsole } from './voice-console';

type Status = 'loading' | 'ready' | 'error';

export function MatchExplorer() {
  const [profile, setProfile] = useState<ApplicantProfile>(EMPTY_PROFILE);
  const [includeNearMisses, setIncludeNearMisses] = useState(false);
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  // Fields the last spoken turn filled, so the profile panel can flag what changed.
  const [recentlyFilled, setRecentlyFilled] = useState<Array<keyof ApplicantProfile>>([]);
  /** Transcript rescued from an extraction that took too long; the form takes over. */
  const [stalledTranscript, setStalledTranscript] = useState<string | null>(null);
  /** Which ready-made profile is loaded, so the results header can say so. */
  const [activePersona, setActivePersona] = useState<string | null>(null);

  const runMatch = useCallback(async (nextProfile: ApplicantProfile, nearMisses: boolean) => {
    setStatus('loading');
    setError(null);

    try {
      setResult(await matchSchemes(nextProfile, { maxFailures: nearMisses ? 1 : 0 }));
      setStatus('ready');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Something went wrong while matching schemes.',
      );
      setStatus('error');
    }
  }, []);

  // An empty profile is a legitimate query: it returns everything still in play,
  // which is the honest starting point before any question has been answered.
  useEffect(() => {
    void runMatch(EMPTY_PROFILE, false);
  }, [runMatch]);

  function updateProfile(patch: Partial<ApplicantProfile>) {
    setProfile((current) => ({ ...current, ...patch }));
    setRecentlyFilled([]);
  }

  /**
   * Voice and the form write to the same profile state, which is what keeps voice an
   * enhancement rather than a parallel implementation: a spoken answer lands in the
   * form fields, and can then be corrected by typing.
   */
  function applyVoiceProfile(next: ApplicantProfile, filled: Array<keyof ApplicantProfile>) {
    setProfile(next);
    setRecentlyFilled(filled);
  }

  function focusField(field: string) {
    const element = document.getElementById(field);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element?.focus({ preventScroll: true });
  }

  const completeness = Math.round(profileCompleteness(profile) * 100);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(21rem,26rem)_1fr] lg:gap-14">
      <div className="space-y-6 lg:sticky lg:top-8 lg:self-start">
        <ErrorBoundary label="Ready-made profiles">
          <DemoPersonas
            disabled={status === 'loading'}
            onSelect={(personaProfile, label) => {
              setProfile(personaProfile);
              setRecentlyFilled([]);
              setStalledTranscript(null);
              setActivePersona(label);
              void runMatch(personaProfile, includeNearMisses);
            }}
          />
        </ErrorBoundary>

        <ErrorBoundary label="Voice input">
          <VoiceConsole
            profile={profile}
            language={language}
            onLanguageChange={setLanguage}
            onProfileChange={applyVoiceProfile}
            onMatch={(match) => {
              setResult(match);
              setStatus('ready');
            }}
            onSlowExtraction={setStalledTranscript}
          />
        </ErrorBoundary>

        {stalledTranscript && (
          <aside className="border-2 border-amber/50 bg-amber/[0.06] p-4" role="status">
            <p className="label-caps text-amber">Interpretation was too slow</p>
            <p className="mt-2 font-sans text-sm leading-relaxed text-ink">
              Nothing is lost — this is what you said. Fill in the form below from it and press
              &ldquo;Find my schemes&rdquo;.
            </p>
            <p className="mt-2 border-l-2 border-amber pl-3 font-sans text-sm italic text-ink-soft">
              {stalledTranscript}
            </p>
            <button
              type="button"
              onClick={() => setStalledTranscript(null)}
              className="mt-3 label-caps underline decoration-rule decoration-2 underline-offset-4 hover:text-ink"
            >
              Dismiss
            </button>
          </aside>
        )}

        <ErrorBoundary label="Your profile">
          <ProfilePanel profile={profile} highlight={recentlyFilled} />
        </ErrorBoundary>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runMatch(profile, includeNearMisses);
          }}
        >
          <div className="sheet p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-lg font-bold text-ink">Or type it in</h2>
              <p className="label-caps" aria-live="polite">
                {completeness}% answered
              </p>
            </div>

            {/* Progress is a hairline rule rather than a chunky bar: it is feedback,
                not the main event. */}
            <div className="mt-2 h-1 w-full bg-rule/50" role="presentation">
              <div
                className="h-full bg-saffron transition-[width] duration-500 ease-out"
                style={{ width: `${completeness}%` }}
              />
            </div>

            <p className="mt-3 font-sans text-sm leading-relaxed text-ink-soft">
              Speaking and typing edit the same answers, so you can correct anything here. Whatever
              you skip is treated as &ldquo;unknown&rdquo;, never as a &ldquo;no&rdquo;.
            </p>

            <div className="mt-6">
              <ProfileForm profile={profile} onChange={updateProfile} />
            </div>

            <label className="mt-5 flex min-h-[3rem] items-center gap-3 font-sans text-sm text-ink-soft">
              <input
                type="checkbox"
                className="h-5 w-5 accent-saffron"
                checked={includeNearMisses}
                onChange={(event) => setIncludeNearMisses(event.target.checked)}
              />
              Also show schemes I just miss out on
            </label>

            <button
              type="submit"
              className="mt-4 min-h-[3.25rem] w-full border-2 border-ink bg-ink px-5 font-sans text-base font-semibold text-paper transition-colors hover:border-saffron hover:bg-saffron disabled:opacity-60"
              disabled={status === 'loading'}
            >
              {status === 'loading' ? 'Checking…' : 'Find my schemes'}
            </button>
          </div>
        </form>
      </div>

      <section aria-labelledby="results-heading" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-ink pb-3">
          <h2 id="results-heading" className="font-display text-2xl font-extrabold text-ink">
            {result ? headline(result) : 'Checking schemes…'}
          </h2>
          {result && (
            <p className="label-caps">
              {activePersona ? `${activePersona} · ` : ''}
              {result.consideredCount} considered · {result.eligibleCount} eligible
              {includeNearMisses ? ` · ${result.nearMissCount} near misses` : ''}
              {OFFLINE_MODE ? ' · offline' : ''}
            </p>
          )}
        </div>

        {/* Skeletons rather than a bare spinner: the shape of what is coming reads as
            progress, and nothing on screen is ever blank. */}
        {status === 'loading' && !result && (
          <div className="mt-6 space-y-5">
            <LoadingPanel label="Matching schemes" lines={4} />
            <LoadingPanel label="Checking criteria" lines={3} />
          </div>
        )}

        {status === 'error' && (
          <div className="mt-6 border-2 border-maroon/40 bg-maroon/[0.05] p-5">
            <p className="font-display text-lg font-bold text-maroon">Could not load schemes</p>
            <p className="mt-1 font-sans text-sm text-ink-soft">{error}</p>
            <p className="mt-3 font-mono text-xs text-ink-faint">
              Start the backend with <code>npm run dev</code> from the repo root, and check that
              Postgres is up (<code>npm run db:up</code>).
            </p>
          </div>
        )}

        {result?.nextQuestion && (
          <div className="mt-6">
            <NextQuestionBanner
              question={result.nextQuestion}
              language={language}
              onFocusField={focusField}
            />
          </div>
        )}

        <div
          className="mt-6 space-y-5"
          aria-busy={status === 'loading'}
          aria-live="polite"
          aria-label="Matching schemes"
        >
          {result?.matches.map((scheme, index) => (
            // Per-card boundary: one scheme with unexpected data cannot take out the list.
            <ErrorBoundary key={scheme.id} label={`Scheme “${scheme.name.slice(0, 40)}”`}>
              <SchemeCard scheme={scheme} index={index} profile={profile} />
            </ErrorBoundary>
          ))}
        </div>

        {status === 'ready' && result?.matches.length === 0 && (
          <p className="mt-6 font-sans text-ink-soft">
            No scheme matches this profile. Try ticking &ldquo;show schemes I just miss out
            on&rdquo; to see which ones came closest, and why.
          </p>
        )}
      </section>
    </div>
  );
}

function headline(result: MatchResponse): string {
  if (result.eligibleCount === 0) return 'No matches yet';
  const noun = result.eligibleCount === 1 ? 'scheme' : 'schemes';
  return result.profileCompleteness === 1
    ? `${result.eligibleCount} ${noun} you qualify for`
    : `${result.eligibleCount} ${noun} still in play`;
}
