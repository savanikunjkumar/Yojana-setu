import Link from 'next/link';
import { MatchExplorer } from '@/components/match-explorer';

export default function HomePage() {
  return (
    <main id="main" className="mx-auto max-w-[84rem] px-5 pb-24 pt-10 sm:px-8 lg:pt-16">
      <header className="animate-rise-in">
        <p className="label-caps">Smart India Hackathon 2026</p>

        {/* The masthead deliberately breaks the grid the results sit on, so the
            page reads as a document with a printed header rather than a dashboard. */}
        <h1 className="mt-3 max-w-[24ch] font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-6xl">
          Find every scheme
          <span className="text-saffron">.</span>
          <br />
          Not just the ones
          <br />
          you have heard of
          <span className="text-saffron">.</span>
        </h1>

        <p className="mt-5 max-w-[54ch] font-sans text-lg leading-relaxed text-ink-soft">
          There are thousands of central and state government schemes, and no way to tell which ones
          apply to you. Answer a few questions and see what you are entitled to — along with the
          reason behind every single result.
        </p>

        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-t border-rule pt-4">
          <Stat value="Every criterion" label="explained, not just a yes or no" />
          <Stat value="One SQL query" label="matches the entire scheme catalogue" />
          <Stat value="13 languages" label="targeted by the voice interface" />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/applications"
            className="inline-flex min-h-[2.75rem] items-center border-2 border-rule px-4 font-sans text-sm font-semibold text-ink transition-colors hover:border-ink"
          >
            Track applications you have already started →
          </Link>
          <Link
            href="/data"
            className="inline-flex min-h-[2.75rem] items-center border-2 border-rule px-4 font-sans text-sm font-semibold text-ink transition-colors hover:border-ink"
          >
            See the data behind the matches →
          </Link>
        </div>
      </header>

      <div className="mt-14 lg:mt-20">
        <MatchExplorer />
      </div>

      <footer className="mt-24 border-t border-rule pt-5">
        <p className="max-w-[70ch] font-sans text-sm leading-relaxed text-ink-faint">
          Eligibility shown here is an indication based on published scheme guidelines, not a
          decision. Always confirm against the official portal linked on each scheme before
          applying.
        </p>
      </footer>
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <p className="font-sans text-sm text-ink-faint">
      <span className="font-display font-bold text-ink">{value}</span>
      <span className="mx-1.5 text-rule" aria-hidden="true">
        /
      </span>
      {label}
    </p>
  );
}
