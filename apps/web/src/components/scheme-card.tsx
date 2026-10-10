import clsx from 'clsx';
import {
  ELIGIBILITY_CRITERIA,
  ELIGIBILITY_CRITERION_META,
  SCHEME_CATEGORY_LABELS,
  describeEligibility,
  regionName,
  type ApplicantProfile,
  type MatchedScheme,
} from '@sih/shared';
import { ApplicationPackPanel } from './application-pack';
import { CriterionChip } from './criterion-chip';

export function SchemeCard({
  scheme,
  index,
  profile,
}: {
  scheme: MatchedScheme;
  index: number;
  /** Passed through so the application pack can be built for this scheme. */
  profile?: ApplicantProfile;
}) {
  const blockers = scheme.failedCriteria.map(
    (criterion) => ELIGIBILITY_CRITERION_META[criterion].label,
  );

  return (
    <article
      className="sheet animate-rise-in relative p-5 sm:p-6"
      // Staggered reveal, capped so a long result list never feels slow.
      style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
    >
      <StatusStamp isEligible={scheme.isEligible} />

      <p className="label-caps">
        {SCHEME_CATEGORY_LABELS[scheme.category]}
        <span aria-hidden="true"> · </span>
        {scheme.state ? regionName(scheme.state) : 'All India'}
      </p>

      <h3 className="mt-2 max-w-[38ch] font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
        {scheme.name}
      </h3>
      <p className="mt-1 font-sans text-sm text-ink-faint">{scheme.ministry}</p>

      <p className="mt-4 max-w-[62ch] font-sans text-[0.9375rem] leading-relaxed text-ink-soft">
        {scheme.benefitText}
      </p>

      {blockers.length > 0 && (
        <p className="mt-4 border-l-2 border-maroon bg-maroon/[0.04] py-2 pl-3 font-sans text-sm text-ink-soft">
          <span className="font-semibold text-maroon">You just miss out</span> because of{' '}
          {joinWords(blockers)}.
        </p>
      )}

      {scheme.needsIncomeVerification && (
        <p className="mt-4 border-l-2 border-amber bg-amber/[0.04] py-2 pl-3 font-sans text-sm text-ink-soft">
          <span className="font-semibold text-amber">One thing to confirm</span> — your income
          bracket straddles this scheme&apos;s limit, so the exact figure decides it.
        </p>
      )}

      <details className="group mt-5">
        <summary className="label-caps cursor-pointer list-none select-none py-1 hover:text-ink">
          <span className="underline decoration-rule decoration-2 underline-offset-4 group-hover:decoration-saffron">
            Why this result
          </span>
        </summary>

        {/* Iterating the canonical criterion list rather than the response object's
            own keys: those arrive in JSONB's internal key order, which is neither
            alphabetical nor the order a person would be asked about them. */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ELIGIBILITY_CRITERIA.map((criterion) => (
            <CriterionChip
              key={criterion}
              criterion={criterion}
              result={scheme.checks[criterion]}
            />
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="label-caps">Who qualifies</p>
            <ul className="mt-1.5 space-y-1 font-sans text-sm text-ink-soft">
              {describeEligibility(scheme.eligibility).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label-caps">Documents to carry</p>
            <ul className="mt-1.5 space-y-1 font-sans text-sm text-ink-soft">
              {scheme.requiredDocuments.map((document) => (
                <li key={document}>{document}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      <div className="perforation mt-5" />

      {/* PROXY schemes are called out on the card itself, not only inside the
          application pack: someone scanning results has to be able to see that this
          match rests on an approximation before they invest any time in it. */}
      {scheme.proxyNote && (
        <p className="mt-4 border-l-2 border-maroon bg-maroon/[0.04] py-2 pl-3 font-sans text-sm text-ink-soft">
          <span className="font-semibold text-maroon">Approximate match</span> — this scheme selects
          people by deprivation status, which we can only estimate. Confirm against the official
          criteria before applying.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <a
          className="min-h-[3rem] inline-flex items-center border-2 border-ink bg-ink px-5 font-sans font-semibold text-paper transition-colors hover:bg-saffron hover:border-saffron"
          href={scheme.applicationUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Apply on the official portal
        </a>
        <a
          className="inline-flex min-h-[2.75rem] items-center font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint underline decoration-rule decoration-2 underline-offset-4 hover:text-ink hover:decoration-saffron"
          href={scheme.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Check the rules yourself
        </a>
      </div>

      {profile && (
        <ApplicationPackPanel schemeId={scheme.id} schemeName={scheme.name} profile={profile} />
      )}
    </article>
  );
}

/** Rubber-stamp verdict, angled and overlapping the sheet's corner. */
function StatusStamp({ isEligible }: { isEligible: boolean }) {
  return (
    <span
      className={clsx(
        'animate-stamp-in absolute -top-3 right-4 -rotate-6 border-2 px-2.5 py-1',
        'font-mono text-[0.625rem] font-medium uppercase tracking-[0.18em]',
        isEligible ? 'border-teal bg-paper text-teal' : 'border-maroon bg-paper text-maroon',
      )}
    >
      {isEligible ? 'Eligible' : 'Near miss'}
    </span>
  );
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
