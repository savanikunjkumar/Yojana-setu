import type { IncomeBracket } from '../enums';

/**
 * Applicants report an income *bracket* (easy to answer out loud), while schemes
 * specify an exact `maxAnnualIncome` cap. Bracket boundaries are therefore the
 * bridge between the two, and they live here as the only numeric source of truth
 * so the SQL matcher never has to know about bracket names.
 *
 * `lower` is inclusive, `upper` is exclusive. `upper: null` means unbounded.
 *
 * Boundaries are chosen to line up with thresholds that actually appear in
 * scheme guidelines (₹2.5L, ₹5L, ₹8L for EWS / OBC non-creamy-layer, ₹10L).
 */
export interface IncomeBracketBounds {
  readonly lower: number;
  readonly upper: number | null;
  readonly label: string;
  readonly labelHi: string;
}

export const INCOME_BRACKET_BOUNDS: Record<IncomeBracket, IncomeBracketBounds> = {
  BELOW_50K: { lower: 0, upper: 50_000, label: 'Below ₹50,000', labelHi: '₹50,000 से कम' },
  INR_50K_TO_1L: {
    lower: 50_000,
    upper: 100_000,
    label: '₹50,000 – ₹1 lakh',
    labelHi: '₹50,000 – ₹1 लाख',
  },
  INR_1L_TO_2_5L: {
    lower: 100_000,
    upper: 250_000,
    label: '₹1 lakh – ₹2.5 lakh',
    labelHi: '₹1 लाख – ₹2.5 लाख',
  },
  INR_2_5L_TO_5L: {
    lower: 250_000,
    upper: 500_000,
    label: '₹2.5 lakh – ₹5 lakh',
    labelHi: '₹2.5 लाख – ₹5 लाख',
  },
  INR_5L_TO_8L: {
    lower: 500_000,
    upper: 800_000,
    label: '₹5 lakh – ₹8 lakh',
    labelHi: '₹5 लाख – ₹8 लाख',
  },
  INR_8L_TO_10L: {
    lower: 800_000,
    upper: 1_000_000,
    label: '₹8 lakh – ₹10 lakh',
    labelHi: '₹8 लाख – ₹10 लाख',
  },
  ABOVE_10L: { lower: 1_000_000, upper: null, label: 'Above ₹10 lakh', labelHi: '₹10 लाख से अधिक' },
};

/** Smallest bracket that fully contains the given annual income, for seeding/imports. */
export function bracketForIncome(annualIncome: number): IncomeBracket {
  const entries = Object.entries(INCOME_BRACKET_BOUNDS) as [IncomeBracket, IncomeBracketBounds][];
  for (const [bracket, bounds] of entries) {
    if (annualIncome >= bounds.lower && (bounds.upper === null || annualIncome < bounds.upper)) {
      return bracket;
    }
  }
  return 'ABOVE_10L';
}

/** Formats rupee amounts the way Indian users read them: ₹2.5 lakh, ₹1.2 crore. */
export function formatINR(amount: number): string {
  if (amount >= 10_000_000) {
    return `₹${trimZeroes(amount / 10_000_000)} crore`;
  }
  if (amount >= 100_000) {
    return `₹${trimZeroes(amount / 100_000)} lakh`;
  }
  return `₹${amount.toLocaleString('en-IN')}`;
}

function trimZeroes(value: number): string {
  return Number(value.toFixed(2)).toString();
}
