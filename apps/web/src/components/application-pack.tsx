'use client';

import clsx from 'clsx';
import { useState } from 'react';
import {
  MATCH_CONFIDENCE_LABELS,
  type ApplicationPack,
  type DocumentChecklistItem,
  type MatchConfidence,
} from '@sih/shared';
import { ApiError, fetchApplicationPack } from '@/lib/api';

/**
 * What to do next, for one scheme.
 *
 * Being told you qualify is the easy half; the gap that actually stops people is not
 * knowing which papers to carry and what to write. This is the checklist, the pre-filled
 * sheet and the link, in that order.
 */
export function ApplicationPackPanel({
  schemeId,
  schemeName,
  profile,
}: {
  schemeId: string;
  schemeName: string;
  profile: unknown;
}) {
  const [pack, setPack] = useState<ApplicationPack | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setStatus('loading');
    setError(null);
    try {
      setPack(await fetchApplicationPack(schemeId, profile));
      setStatus('idle');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not build the checklist.');
      setStatus('error');
    }
  }

  if (!pack) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={load}
          disabled={status === 'loading'}
          className="min-h-[2.75rem] border-2 border-teal px-4 font-sans text-sm font-semibold text-teal transition-colors hover:bg-teal hover:text-paper disabled:opacity-60"
        >
          {status === 'loading' ? 'Preparing…' : 'Help me apply'}
        </button>
        {error && <p className="mt-2 font-sans text-sm text-maroon">{error}</p>}
      </div>
    );
  }

  const needed = pack.checklist.filter((item) => item.likelihood === 'NEED_TO_OBTAIN');
  const have = pack.checklist.filter((item) => item.likelihood === 'LIKELY_HAVE');

  return (
    <div className="mt-5 border-t-2 border-ink pt-4">
      <ConfidenceBanner confidence={pack.confidence} proxyWarning={pack.proxyWarning} />

      {pack.unverifiedCriteria.length > 0 && (
        <p className="mt-3 border-l-2 border-amber bg-amber/[0.05] py-2 pl-3 font-sans text-sm text-ink-soft">
          <span className="font-semibold text-amber">Still to confirm:</span>{' '}
          {pack.unverifiedCriteria.join(', ')}. These are unanswered, not failed.
        </p>
      )}

      <section className="mt-5">
        <h4 className="font-display text-base font-bold text-ink">
          Documents to carry
          <span className="ml-2 font-sans text-sm font-normal text-ink-faint">
            {have.length} of {pack.checklist.length} you likely already have
          </span>
        </h4>

        <ul className="mt-2 divide-y divide-rule">
          {pack.checklist.map((item) => (
            <ChecklistRow key={item.document} item={item} />
          ))}
        </ul>

        {needed.length > 0 && (
          <p className="mt-3 font-sans text-sm text-ink-soft">
            Start with the {needed.length} marked <span className="font-semibold">to obtain</span> —
            those take the longest.
          </p>
        )}
      </section>

      <PrintableSummary pack={pack} schemeName={schemeName} />

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href={pack.applyUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-[3rem] items-center border-2 border-ink bg-ink px-5 font-sans font-semibold text-paper transition-colors hover:border-saffron hover:bg-saffron"
        >
          Go to the official application
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-[3rem] border-2 border-rule px-4 font-sans text-sm font-semibold text-ink transition-colors hover:border-ink"
        >
          Print this summary
        </button>
      </div>
    </div>
  );
}

/**
 * How much weight the match bears.
 *
 * PROXY is styled as a warning rather than a badge, because presenting an approximated
 * match with the same confidence as one against published criteria would overstate what
 * we actually know — and that is the claim a citizen acts on.
 */
function ConfidenceBanner({
  confidence,
  proxyWarning,
}: {
  confidence: MatchConfidence;
  proxyWarning: string | null;
}) {
  if (confidence === 'PROXY_APPROXIMATED') {
    return (
      <div className="border-2 border-maroon bg-maroon/[0.06] p-4">
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-maroon">
          Approximate match — verify before applying
        </p>
        <p className="mt-2 font-sans text-sm leading-relaxed text-ink">
          {proxyWarning ??
            'This scheme selects beneficiaries by criteria we could not represent exactly.'}
        </p>
        <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">
          Treat this as a lead, not a confirmation. Check the official criteria on the
          department&apos;s page before spending time or money on an application.
        </p>
      </div>
    );
  }

  const styles: Record<Exclude<MatchConfidence, 'PROXY_APPROXIMATED'>, string> = {
    CONFIRMED: 'border-teal/40 bg-teal/[0.05] text-teal',
    NEEDS_ANSWERS: 'border-amber/40 bg-amber/[0.05] text-amber',
  };

  return (
    <div className={clsx('border-2 p-3', styles[confidence])}>
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em]">
        {MATCH_CONFIDENCE_LABELS[confidence]}
      </p>
    </div>
  );
}

function ChecklistRow({ item }: { item: DocumentChecklistItem }) {
  const marks: Record<
    DocumentChecklistItem['likelihood'],
    { mark: string; className: string; label: string }
  > = {
    LIKELY_HAVE: { mark: '✓', className: 'text-teal', label: 'likely have' },
    NEED_TO_OBTAIN: { mark: '!', className: 'text-maroon', label: 'to obtain' },
    UNKNOWN: { mark: '?', className: 'text-amber', label: 'check' },
  };
  const mark = marks[item.likelihood];

  return (
    <li className="flex items-baseline gap-3 py-2">
      <span
        aria-hidden="true"
        className={clsx('w-4 shrink-0 text-center font-mono font-medium', mark.className)}
      >
        {mark.mark}
      </span>
      <div className="min-w-0">
        <p className="font-sans text-sm font-medium text-ink">
          {item.document}
          <span className="sr-only"> — {mark.label}</span>
        </p>
        <p className="font-sans text-xs leading-snug text-ink-faint">{item.reason}</p>
      </div>
    </li>
  );
}

/**
 * The sheet someone takes to the office.
 *
 * Fields the applicant has not given are printed as ruled blank lines rather than hidden,
 * so the paper doubles as the form-filling worksheet. `print:` utilities strip the
 * surrounding app so a browser print produces just this.
 */
function PrintableSummary({ pack, schemeName }: { pack: ApplicationPack; schemeName: string }) {
  return (
    <section className="mt-6 border border-paper-edge bg-paper-deep/40 p-4 print:border-0 print:bg-transparent print:p-0">
      <h4 className="font-display text-base font-bold text-ink">Application summary</h4>
      <p className="mt-1 font-sans text-xs text-ink-faint print:hidden">
        Pre-filled from what you told us. Blank lines are for you to complete.
      </p>

      <p className="mt-3 hidden font-display text-lg font-bold print:block">{schemeName}</p>

      <dl className="mt-3">
        {pack.prefilled.map((field) => (
          <div
            key={field.label}
            className="grid grid-cols-[10rem_1fr] items-baseline gap-3 border-b border-rule py-1.5"
          >
            <dt className="label-caps">{field.label}</dt>
            <dd
              className={clsx(
                'font-sans text-sm',
                field.value ? 'font-medium text-ink' : 'text-ink-faint',
              )}
            >
              {field.value ?? <span className="italic">to be filled in</span>}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 font-sans text-xs leading-relaxed text-ink-faint">
        Source of these rules: {pack.sourceUrl}
      </p>
    </section>
  );
}
