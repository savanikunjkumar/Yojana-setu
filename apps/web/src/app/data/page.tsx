import Link from 'next/link';
import { StatsView } from '@/components/stats-view';

export const metadata = {
  title: 'The data behind the matches — Yojana Setu',
  description:
    'How many schemes we hold, where they came from, and how much of each eligibility rule we could actually extract.',
};

export default function DataPage() {
  return (
    <main id="main" className="mx-auto max-w-[68rem] px-5 pb-24 pt-10 sm:px-8 lg:pt-16">
      <header className="animate-rise-in">
        <p className="label-caps">Data foundation</p>
        <h1 className="mt-3 max-w-[24ch] font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          What we hold, and
          <br />
          what we could not
          <br />
          read
          <span className="text-saffron">.</span>
        </h1>
        <p className="mt-5 max-w-[58ch] font-sans text-lg leading-relaxed text-ink-soft">
          Eligibility rules are extracted from prose written by ministries. Some of that prose
          states a rule plainly and some does not, so coverage is partial — these are the real
          numbers rather than the flattering ones.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex min-h-[2.75rem] items-center border-2 border-rule px-4 font-sans text-sm font-semibold text-ink transition-colors hover:border-ink focus-visible:border-ink"
        >
          ← Back to finding schemes
        </Link>
      </header>

      <div className="mt-12">
        <StatsView />
      </div>
    </main>
  );
}
