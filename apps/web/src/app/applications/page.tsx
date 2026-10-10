import Link from 'next/link';
import { ApplicationsView } from '@/components/applications-view';

export const metadata = {
  title: 'Your applications — Yojana Setu',
  description:
    'Track every scheme application you have started, how long it has been waiting, and what you were last told.',
};

export default function ApplicationsPage() {
  return (
    <main id="main" className="mx-auto max-w-[64rem] px-5 pb-24 pt-10 sm:px-8 lg:pt-16">
      <header className="animate-rise-in">
        <p className="label-caps">Status tracker</p>
        <h1 className="mt-3 max-w-[22ch] font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          What happened to
          <br />
          your applications
          <span className="text-saffron">?</span>
        </h1>
        <p className="mt-5 max-w-[54ch] font-sans text-lg leading-relaxed text-ink-soft">
          Applying is not the end of it. Track what you have filed, how long it has been sitting,
          and what the office last told you — so nothing quietly gets forgotten.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex min-h-[2.75rem] items-center border-2 border-rule px-4 font-sans text-sm font-semibold text-ink transition-colors hover:border-ink"
        >
          ← Back to finding schemes
        </Link>
      </header>

      <div className="mt-12">
        <ApplicationsView />
      </div>

      <footer className="mt-20 border-t border-rule pt-5">
        <p className="max-w-[70ch] font-sans text-sm leading-relaxed text-ink-faint">
          Statuses here are what you or an officer recorded. Automated checking across department
          portals is designed but not enabled — most portals need your own login, and a stale
          scraper reporting confidently would be worse than asking you.
        </p>
      </footer>
    </main>
  );
}
