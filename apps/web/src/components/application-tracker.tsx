'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  regionName,
  type ApplicationDashboard,
  type ApplicationStatus,
  type TrackedApplication,
} from '@sih/shared';
import { ApiError, fetchApplicationDashboard, updateApplicationStatus } from '@/lib/api';

/**
 * Status tracker.
 *
 * Manual updates are the primary mechanism, not a fallback. Automated cross-portal
 * checking is designed (see apps/api/src/assistance/portal-status-checker.ts) but
 * deliberately unimplemented: most portals need the citizen's own credentials, and their
 * status pages change without notice. Someone who was told something at a counter must be
 * able to record it, and that path always works.
 */
export function ApplicationTracker({ applicantId }: { applicantId: string | null }) {
  const [dashboard, setDashboard] = useState<ApplicationDashboard | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!applicantId) return;
    setStatus('loading');
    try {
      setDashboard(await fetchApplicationDashboard(applicantId));
      setStatus('idle');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your applications.');
      setStatus('error');
    }
  }, [applicantId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!applicantId) {
    return (
      <section className="sheet p-5">
        <h3 className="font-display text-lg font-bold text-ink">Your applications</h3>
        <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">
          Save your details to start tracking applications. Nothing is tracked until you ask for it.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="tracker-heading" className="sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 id="tracker-heading" className="font-display text-lg font-bold text-ink">
          Your applications
        </h3>
        {dashboard && (
          <p className="label-caps">
            {dashboard.totalTracked} tracked
            {dashboard.needingAttention > 0 && (
              <span className="text-maroon"> · {dashboard.needingAttention} need chasing</span>
            )}
          </p>
        )}
      </div>

      {status === 'error' && <p className="mt-3 font-sans text-sm text-maroon">{error}</p>}

      {dashboard?.totalTracked === 0 && (
        <p className="mt-3 font-sans text-sm text-ink-soft">
          Nothing tracked yet. Use &ldquo;Help me apply&rdquo; on a scheme, then start tracking it.
        </p>
      )}

      <div className="mt-4 space-y-4">
        {dashboard?.applications.map((application) => (
          <ApplicationRow key={application.id} application={application} onUpdated={load} />
        ))}
      </div>
    </section>
  );
}

function ApplicationRow({
  application,
  onUpdated,
}: {
  application: TrackedApplication;
  onUpdated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(application.notes ?? '');
  const [expanded, setExpanded] = useState(false);

  async function setStatusTo(next: ApplicationStatus) {
    setSaving(true);
    try {
      await updateApplicationStatus(application.id, { status: next, notes: note || null });
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      className={clsx(
        'border p-4',
        application.needsAttention ? 'border-maroon/40 bg-maroon/[0.03]' : 'border-paper-edge',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="max-w-[36ch] font-display text-base font-bold leading-snug text-ink">
          {application.schemeName}
        </h4>
        <StatusPill status={application.status} />
      </div>

      <p className="mt-1 label-caps">
        {application.schemeState ? regionName(application.schemeState) : 'All India'}
      </p>

      {/* Elapsed times come from the server so every device agrees — this is the number
          a citizen quotes when they ring the department. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-sans text-sm text-ink-soft">
        <div>
          <dt className="inline label-caps">Submitted </dt>
          <dd className="inline">
            {application.daysSinceApplied === null
              ? 'not yet'
              : application.daysSinceApplied === 0
                ? 'today'
                : `${application.daysSinceApplied} days ago`}
          </dd>
        </div>
        <div>
          <dt className="inline label-caps">Last checked </dt>
          <dd className="inline">
            {application.daysSinceChecked === null
              ? 'never'
              : application.daysSinceChecked === 0
                ? 'today'
                : `${application.daysSinceChecked} days ago`}
          </dd>
        </div>
      </dl>

      {application.needsAttention && (
        <p className="mt-3 border-l-2 border-maroon bg-maroon/[0.05] py-2 pl-3 font-sans text-sm text-ink-soft">
          No movement for a while. Worth ringing the department or visiting the office, then record
          what they tell you below.
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="mt-3 label-caps underline decoration-rule decoration-2 underline-offset-4 hover:text-ink"
      >
        {expanded ? 'Close' : 'Update status'}
      </button>

      {expanded && (
        <div className="mt-3 border-t border-rule pt-3">
          <label className="label-caps" htmlFor={`note-${application.id}`}>
            What were you told?
          </label>
          <textarea
            id={`note-${application.id}`}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Block office said verification is pending"
            className="field mt-1 resize-y border-2 border-rule px-2 py-2 focus:border-saffron"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {APPLICATION_STATUSES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                disabled={saving || candidate === application.status}
                onClick={() => void setStatusTo(candidate)}
                className={clsx(
                  'min-h-[2.5rem] border px-3 font-sans text-sm transition-colors disabled:opacity-40',
                  candidate === application.status
                    ? 'border-ink bg-ink text-paper'
                    : 'border-rule text-ink hover:border-ink',
                )}
              >
                {APPLICATION_STATUS_LABELS[candidate]}
              </button>
            ))}
          </div>
        </div>
      )}

      {application.notes && !expanded && (
        <p className="mt-2 font-sans text-sm italic text-ink-faint">{application.notes}</p>
      )}
    </article>
  );
}

function StatusPill({ status }: { status: ApplicationStatus }) {
  const styles: Record<ApplicationStatus, string> = {
    NOT_STARTED: 'border-rule text-ink-faint',
    IN_PROGRESS: 'border-amber text-amber',
    SUBMITTED: 'border-teal text-teal',
    UNDER_REVIEW: 'border-teal text-teal',
    APPROVED: 'border-teal bg-teal text-paper',
    REJECTED: 'border-maroon text-maroon',
  };

  return (
    <span
      className={clsx(
        'border px-2 py-1 font-mono text-[0.625rem] uppercase tracking-[0.14em]',
        styles[status],
      )}
    >
      {APPLICATION_STATUS_LABELS[status]}
    </span>
  );
}
