'use client';

import { DEMO_PERSONAS, type ApplicantProfile } from '@sih/shared';
import { OFFLINE_MODE, SNAPSHOT_INFO } from '@/lib/demo-mode';

/**
 * One-click personas.
 *
 * A live demo cannot depend on speaking clearly into a laptop microphone in a noisy hall, so
 * each persona fills the same profile state the voice and typed paths write to. Whichever
 * route is used, the matcher sees identical input — the shortcut is in the input, not in the
 * matching.
 */
export function DemoPersonas({
  onSelect,
  disabled = false,
}: {
  onSelect: (profile: ApplicantProfile, label: string) => void;
  disabled?: boolean;
}) {
  return (
    <section aria-labelledby="personas-heading" className="sheet p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="personas-heading" className="font-display text-base font-bold text-ink">
          Try a ready-made profile
        </h2>
        {OFFLINE_MODE && (
          <span className="border border-amber px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-amber">
            offline
          </span>
        )}
      </div>

      <p className="mt-1 font-sans text-sm text-ink-soft">
        Each one produces a different result from the real scheme data.
      </p>

      <ul className="mt-4 space-y-3">
        {DEMO_PERSONAS.map((persona) => (
          <li key={persona.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(persona.profile, persona.name)}
              className="w-full border-2 border-rule p-3 text-left transition-colors hover:border-saffron focus-visible:border-saffron disabled:opacity-50"
            >
              <span className="block font-display text-base font-bold text-ink">
                {persona.name}
              </span>
              <span className="mt-0.5 block font-sans text-sm leading-snug text-ink-soft">
                {persona.summary}
              </span>
              <span className="mt-1.5 block font-mono text-[0.625rem] uppercase tracking-[0.1em] text-ink-faint">
                shows: {persona.demonstrates}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {OFFLINE_MODE && (
        <p className="mt-4 border-t border-rule pt-3 font-sans text-xs leading-relaxed text-ink-faint">
          Offline mode is on. Results are a recording of real matches against{' '}
          {SNAPSHOT_INFO.schemeCount} schemes, captured{' '}
          {new Date(SNAPSHOT_INFO.capturedAt).toLocaleDateString('en-IN')} — genuine query
          output, just not live. Nothing is sent to any API.
        </p>
      )}
    </section>
  );
}
