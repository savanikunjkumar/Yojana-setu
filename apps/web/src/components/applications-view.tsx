'use client';

import { useEffect, useState } from 'react';
import { ApplicationTracker } from './application-tracker';

/**
 * Holds the applicant identity for the tracker.
 *
 * The id lives in localStorage rather than a login. This is a prototype for people who
 * may not have an email address, so demanding an account before they can track a form
 * they filed would be its own barrier. A real deployment would tie this to whatever
 * identity the department already uses.
 */
const STORAGE_KEY = 'yojana-setu.applicant-id';

export function ApplicationsView() {
  const [applicantId, setApplicantId] = useState<string | null>(null);
  const [entry, setEntry] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setApplicantId(window.localStorage.getItem(STORAGE_KEY));
    setLoaded(true);
  }, []);

  function remember(id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    window.localStorage.setItem(STORAGE_KEY, trimmed);
    setApplicantId(trimmed);
  }

  function forget() {
    window.localStorage.removeItem(STORAGE_KEY);
    setApplicantId(null);
  }

  if (!loaded) return null;

  return (
    <div className="space-y-6">
      <ApplicationTracker applicantId={applicantId} />

      {applicantId ? (
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-faint">
          tracking as {applicantId.slice(0, 8)}…{' '}
          <button
            type="button"
            onClick={forget}
            className="underline decoration-rule decoration-2 underline-offset-4 hover:text-ink"
          >
            switch
          </button>
        </p>
      ) : (
        <section className="sheet p-5">
          <h3 className="font-display text-base font-bold text-ink">Already have a profile id?</h3>
          <p className="mt-1 font-sans text-sm text-ink-soft">
            Saving your details on the home page creates one. Paste it here to see the applications
            attached to it.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <input
              className="field min-w-[20rem] border-2 border-rule px-2"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              aria-label="Applicant id"
            />
            <button
              type="button"
              onClick={() => remember(entry)}
              className="min-h-[3rem] border-2 border-ink bg-ink px-5 font-sans font-semibold text-paper transition-colors hover:border-saffron hover:bg-saffron"
            >
              Show my applications
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
