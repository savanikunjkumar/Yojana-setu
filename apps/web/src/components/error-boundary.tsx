'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Stops one broken panel from blanking the page.
 *
 * A white screen in front of judges is the worst possible failure, and it is what an
 * unhandled render error produces by default. Each major panel gets its own boundary so a
 * failure is contained to that panel and the rest of the demo keeps working — the results
 * list surviving a broken application pack is the difference between a rough moment and a
 * dead demo.
 *
 * The raw error is logged for the console and deliberately not shown to the user; a stack
 * trace tells a citizen nothing and tells a judge only that we leak internals.
 */
interface Props {
  children: ReactNode;
  /** Names the area, so the message can say what is unavailable. */
  label: string;
  /** Optional replacement UI. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div role="alert" className="border-2 border-maroon/40 bg-maroon/[0.04] p-4">
        <p className="font-display text-base font-bold text-maroon">
          {this.props.label} is unavailable
        </p>
        <p className="mt-1 font-sans text-sm leading-relaxed text-ink-soft">
          Something went wrong in this panel. The rest of the page still works.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-3 min-h-[2.75rem] border-2 border-maroon px-4 font-sans text-sm font-semibold text-maroon transition-colors hover:bg-maroon hover:text-paper"
        >
          Try this panel again
        </button>
      </div>
    );
  }
}

/** Shared skeleton, so every async panel shows progress the same way. */
export function LoadingPanel({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="sheet p-5">
      <p className="label-caps">{label}</p>
      <div className="mt-3 space-y-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className="h-3 animate-pulse bg-rule/60"
            // Varied widths so it reads as loading content rather than a progress bar.
            style={{ width: `${100 - index * 12}%`, animationDelay: `${index * 120}ms` }}
          />
        ))}
      </div>
      <span className="sr-only">Loading {label}</span>
    </div>
  );
}

/** Inline spinner for buttons and small controls. */
export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4 animate-spin"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <circle cx="12" cy="12" r="9" strokeOpacity={0.25} />
        <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
