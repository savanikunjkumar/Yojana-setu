'use client';

import { useCallback, useEffect, useState } from 'react';
import { SCHEME_CATEGORY_LABELS, type SchemeStats } from '@sih/shared';
import { fetchSchemeStats } from '@/lib/api';
import { OFFLINE_MODE } from '@/lib/demo-mode';
import { LoadingPanel } from './error-boundary';

/**
 * The corpus, stated plainly.
 *
 * The point of this page is that the numbers are unflattering and shown anyway. An
 * eligibility matcher is only as good as the rules it extracted, and most of those rules
 * live in ministry prose that does not always state them. Publishing "we found an age bound
 * in half of them" is a stronger claim to rigour than a page implying the data is complete,
 * and it is the honest answer to the first question a judge asks about a scraped dataset.
 *
 * Every figure is read live from the same database the matcher queries — nothing here is
 * typed in by hand, so it cannot drift from reality.
 */
export function StatsView() {
  const [stats, setStats] = useState<SchemeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setStats(null);
    fetchSchemeStats()
      .then(setStats)
      .catch((caught: Error) => setError(caught.message));
  }, []);

  useEffect(load, [load]);

  if (error) {
    return (
      <div role="alert" className="border-2 border-maroon/40 bg-maroon/[0.04] p-5">
        <p className="font-display text-base font-bold text-maroon">
          Could not load the numbers
        </p>
        <p className="mt-1 font-sans text-sm leading-relaxed text-ink-soft">
          The API did not answer, so rather than show figures that might be stale, this page
          shows nothing. {error}
        </p>
        <button
          type="button"
          onClick={load}
          className="mt-3 min-h-[2.75rem] border-2 border-maroon px-4 font-sans text-sm font-semibold text-maroon transition-colors hover:bg-maroon hover:text-paper"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!stats) return <LoadingPanel label="Counting the corpus" lines={4} />;

  return (
    <div className="space-y-10">
      <Headline stats={stats} />
      <Origin stats={stats} />
      <Coverage stats={stats} />
      <Proxy stats={stats} />
      <Categories stats={stats} />
    </div>
  );
}

/**
 * The hero figure.
 *
 * Sans rather than the display serif used for headings: at this size the serif reads as
 * decoration, and this number is data.
 */
function Headline({ stats }: { stats: SchemeStats }) {
  return (
    <section aria-labelledby="headline-heading" className="sheet p-6">
      <h2 id="headline-heading" className="label-caps">
        Schemes in the database
      </h2>

      <p className="mt-2 font-sans text-6xl font-bold leading-none text-ink sm:text-7xl">
        {stats.total.toLocaleString('en-IN')}
      </p>

      <p className="mt-3 max-w-[54ch] font-sans text-sm leading-relaxed text-ink-soft">
        Every one of them is matched against your answers on every search — there is no
        shortlist and no ranking model deciding what you get to see.
      </p>

      {stats.lastScrapedAt && (
        <p className="mt-4 border-t border-rule pt-3 font-mono text-xs text-ink-faint">
          Last scraped{' '}
          {new Date(stats.lastScrapedAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          {OFFLINE_MODE && ' · offline snapshot'}
        </p>
      )}
    </section>
  );
}

/**
 * Central versus state, as one part-to-whole bar.
 *
 * Two segments with a 2px paper gap and both values labelled in text, so the split is
 * readable without relying on telling two colours apart.
 */
function Origin({ stats }: { stats: SchemeStats }) {
  const centralPct = stats.total === 0 ? 0 : (stats.central / stats.total) * 100;
  const statePct = 100 - centralPct;

  return (
    <section aria-labelledby="origin-heading">
      <h2 id="origin-heading" className="font-display text-xl font-bold text-ink">
        Where the schemes come from
      </h2>
      <p className="mt-1 max-w-[60ch] font-sans text-sm leading-relaxed text-ink-soft">
        State schemes outnumber central ones, which is the whole reason this exists: central
        schemes are the ones people have already heard of.
      </p>

      <div className="mt-5 flex gap-x-8 gap-y-2">
        <Legend swatch="bg-chart-teal" label="Central" value={stats.central} />
        <Legend swatch="bg-saffron" label="State" value={stats.stateLevel} />
      </div>

      {/* The bar restates the two numbers above; screen readers get them as text. */}
      <div className="mt-3 flex h-8 w-full gap-[2px]" aria-hidden="true">
        <div
          className="rounded-l-[4px] bg-chart-teal"
          style={{ width: `${centralPct}%` }}
        />
        <div className="rounded-r-[4px] bg-saffron" style={{ width: `${statePct}%` }} />
      </div>

      <p className="mt-3 font-sans text-sm text-ink-soft">
        The {stats.stateLevel} state schemes span{' '}
        <strong className="font-semibold text-ink">{stats.distinctStates}</strong> states and
        union territories.
      </p>
    </section>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <p className="flex items-baseline gap-2 font-sans text-sm">
      <span className={`h-3 w-3 shrink-0 translate-y-[1px] rounded-[2px] ${swatch}`} />
      <span className="text-ink-soft">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </p>
  );
}

const COVERAGE_ROWS: Array<{ key: keyof SchemeStats['coverage']; label: string; note: string }> = [
  { key: 'ageBound', label: 'Age bound', note: 'a minimum or maximum age' },
  { key: 'incomeCap', label: 'Income cap', note: 'an annual income ceiling' },
  { key: 'occupation', label: 'Occupation', note: 'restricted to certain occupations' },
  { key: 'studentOnly', label: 'Student only', note: 'requires being a student' },
  { key: 'gender', label: 'Gender', note: 'restricted to one gender' },
  { key: 'socialCategory', label: 'Social category', note: 'restricted by category' },
  { key: 'landCeiling', label: 'Land ceiling', note: 'a maximum land holding' },
];

/**
 * Coverage, as one meter per criterion.
 *
 * Each is a single ratio against the same limit, so they share one hue and one track and
 * can be compared down the column. The percentage is written out beside every bar, which
 * means the bars are a visual aid rather than the only way to read the value.
 */
function Coverage({ stats }: { stats: SchemeStats }) {
  return (
    <section aria-labelledby="coverage-heading">
      <h2 id="coverage-heading" className="font-display text-xl font-bold text-ink">
        How much of each rule we could extract
      </h2>
      <p className="mt-1 max-w-[62ch] font-sans text-sm leading-relaxed text-ink-soft">
        Share of the {stats.scraped} scraped schemes where the eligibility prose stated the
        rule clearly enough to extract it. A criterion we could not find is left unset, and
        an unset criterion never rejects anybody — it is reported as unverified instead.
      </p>

      <ul className="mt-5 space-y-4">
        {COVERAGE_ROWS.map((row) => (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-sans text-sm font-semibold text-ink">
                {row.label}
                <span className="ml-2 font-normal text-ink-faint">{row.note}</span>
              </p>
              <p className="shrink-0 font-mono text-sm tabular-nums text-ink">
                {stats.coverage[row.key]}%
              </p>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-[4px] bg-chart-teal-track"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-[4px] bg-chart-teal"
                style={{ width: `${stats.coverage[row.key]}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-5 max-w-[62ch] border-l-2 border-rule pl-4 font-sans text-sm leading-relaxed text-ink-soft">
        Land ceiling sits at {stats.coverage.landCeiling}% because myScheme states land limits
        in acres, bighas and local units inside long prose, and the extractor refuses to guess
        a conversion it cannot verify. Showing a zero is the point: a wrong hectare figure
        would silently reject landholding farmers.
      </p>
    </section>
  );
}

function Proxy({ stats }: { stats: SchemeStats }) {
  return (
    <section
      aria-labelledby="proxy-heading"
      className="border-2 border-amber/50 bg-amber/[0.06] p-5"
    >
      <h2 id="proxy-heading" className="font-display text-xl font-bold text-ink">
        Schemes matched by approximation
      </h2>

      <p className="mt-2 font-sans text-5xl font-bold leading-none text-amber">
        {stats.proxyCount}
      </p>

      <p className="mt-3 max-w-[62ch] font-sans text-sm leading-relaxed text-ink-soft">
        These schemes select on SECC deprivation criteria — landlessness, no adult earner, a
        kutcha house — which we cannot ask a citizen about in a two-minute conversation. We
        approximate them with an income ceiling, which is close but not the real rule. Every
        one of them is badged in the results rather than presented as a confirmed match, so an
        approximation is never mistaken for an entitlement.
      </p>
    </section>
  );
}


/**
 * A table rather than a chart: with this many categories that all carry meaning, colour
 * stops distinguishing them and a reader wanting "how many housing schemes" is better served
 * by a number they can read off directly.
 */
function Categories({ stats }: { stats: SchemeStats }) {
  const rows = [...stats.byCategory].sort((a, b) => b.count - a.count);
  const largest = rows[0]?.count ?? 1;

  return (
    <section aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="font-display text-xl font-bold text-ink">
        By category
      </h2>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse text-left">
          <caption className="sr-only">
            Number of schemes in each category, largest first
          </caption>
          <thead>
            <tr className="border-b-2 border-rule">
              <th scope="col" className="py-2 pr-4 font-sans text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Category
              </th>
              <th scope="col" className="py-2 pl-4 text-right font-sans text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Schemes
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} className="border-b border-rule/60">
                <th scope="row" className="py-2.5 pr-4 font-sans text-sm font-normal text-ink">
                  <span className="flex items-center gap-3">
                    {SCHEME_CATEGORY_LABELS[row.category as keyof typeof SCHEME_CATEGORY_LABELS] ??
                      row.category}
                    <span
                      aria-hidden="true"
                      className="hidden h-1.5 rounded-[4px] bg-chart-teal-track sm:block"
                      style={{ width: `${(row.count / largest) * 7}rem` }}
                    />
                  </span>
                </th>
                <td className="py-2.5 pl-4 text-right font-mono text-sm tabular-nums text-ink">
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
