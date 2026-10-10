import clsx from 'clsx';
import {
  ELIGIBILITY_CRITERION_META,
  type CheckResult,
  type EligibilityCriterion,
} from '@sih/shared';

const STYLES: Record<CheckResult, { chip: string; mark: string; srLabel: string }> = {
  PASS: { chip: 'border-teal/30 bg-teal/5 text-teal', mark: '✓', srLabel: 'meets' },
  FAIL: { chip: 'border-maroon/30 bg-maroon/5 text-maroon', mark: '✕', srLabel: 'does not meet' },
  UNKNOWN: {
    chip: 'border-amber/30 bg-amber/5 text-amber',
    mark: '?',
    srLabel: 'not yet answered',
  },
};

export function CriterionChip({
  criterion,
  result,
}: {
  criterion: EligibilityCriterion;
  result: CheckResult;
}) {
  const style = STYLES[result];
  const { label } = ELIGIBILITY_CRITERION_META[criterion];

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.08em]',
        style.chip,
      )}
    >
      <span aria-hidden="true" className="text-xs font-medium leading-none">
        {style.mark}
      </span>
      <span className="sr-only">{style.srLabel}: </span>
      {label}
    </span>
  );
}
