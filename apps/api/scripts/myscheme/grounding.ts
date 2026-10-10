import type { EligibilityRule } from '@sih/shared';
import type { GroundingFailure } from './types';
import { collectNumbers, collectWordNumbers } from './text';

/**
 * Numeric grounding check.
 *
 * An LLM reading eligibility prose fails in a specific and dangerous way: it
 * produces a plausible number that the source never stated. In this domain that
 * is not a cosmetic error — an invented income ceiling silently excludes the
 * citizens a scheme exists to serve.
 *
 * So every non-null numeric bound must be traceable to a number that actually
 * appears in the prose, in some recognised form (plain digits, Indian grouping,
 * lakh/crore, acres converted to hectares, or spelled out). Anything else is
 * rejected rather than stored, which is what "do not guess" has to mean in
 * practice.
 *
 * Two deliberate exemptions:
 *   - a `0` lower bound, which is semantically the same as "no lower bound";
 *   - the PROXY income ceiling, which is applied by us *after* this check and is
 *     recorded separately for review.
 */
export function checkGrounding(rule: EligibilityRule, prose: string): GroundingFailure[] {
  const grounded = new Set([...collectNumbers(prose), ...collectWordNumbers(prose)]);
  const failures: GroundingFailure[] = [];

  const numericFields: Array<[keyof EligibilityRule, number | null]> = [
    ['minAge', rule.minAge],
    ['maxAge', rule.maxAge],
    ['maxAnnualIncome', rule.maxAnnualIncome],
    ['maxLandHolding', rule.maxLandHolding],
  ];

  for (const [field, value] of numericFields) {
    if (value === null) continue;
    if (value === 0) continue;

    if (!isGrounded(value, grounded)) {
      failures.push({
        field: String(field),
        value,
        reason: `${String(field)}=${value} does not appear in the source prose`,
      });
    }
  }

  return failures;
}

/**
 * Exact match for integers; a small relative tolerance for fractional values,
 * since an acre-to-hectare conversion will not land on the same last decimal.
 */
function isGrounded(value: number, grounded: Set<number>): boolean {
  if (grounded.has(value)) return true;

  for (const candidate of grounded) {
    if (Number.isInteger(value) && Number.isInteger(candidate)) continue;
    const tolerance = Math.max(0.02, Math.abs(value) * 0.01);
    if (Math.abs(candidate - value) <= tolerance) return true;
  }

  return false;
}

/**
 * Plausibility guard.
 *
 * Grounding proves a number came from the page. It cannot prove the number was
 * read off the *right* clause — a benefit amount, a monthly figure or a calendar
 * year all appear in the prose too, so a misattributed value passes grounding
 * cleanly. These bounds catch the resulting nonsense.
 *
 * The thresholds are deliberately wide. This is a sanity check on the reading, not
 * a policy opinion about what a scheme ought to say, so only genuinely impossible
 * values are refused.
 */
export function checkPlausibility(rule: EligibilityRule): GroundingFailure[] {
  const failures: GroundingFailure[] = [];

  // No Indian scheme sets an annual *household* income ceiling below ₹10,000; a
  // figure that small is a monthly amount, a benefit value or a year.
  if (rule.maxAnnualIncome !== null && rule.maxAnnualIncome < 10_000) {
    failures.push({
      field: 'maxAnnualIncome',
      value: rule.maxAnnualIncome,
      reason: `maxAnnualIncome=${rule.maxAnnualIncome} is too low to be an annual income ceiling — likely a monthly figure, a benefit amount or a year`,
    });
  }

  // Land ceilings in scheme guidelines run from a fraction of a hectare to about
  // ten; beyond a hundred the figure is not a smallholding limit.
  if (rule.maxLandHolding !== null && rule.maxLandHolding > 100) {
    failures.push({
      field: 'maxLandHolding',
      value: rule.maxLandHolding,
      reason: `maxLandHolding=${rule.maxLandHolding} hectares is far beyond any smallholding limit — check the unit`,
    });
  }

  if (rule.minAge !== null && rule.minAge > 90) {
    failures.push({
      field: 'minAge',
      value: rule.minAge,
      reason: `minAge=${rule.minAge} would exclude almost everyone — likely read from the wrong clause`,
    });
  }

  return failures;
}

/**
 * Categorical criteria get a lighter check: the wildcard always passes, and a
 * restriction has to have *some* textual support. This is intentionally weaker
 * than the numeric check — "for women" can be expressed a hundred ways, and
 * rejecting a correct reading is worse than accepting a slightly loose one for
 * a criterion that cannot fabricate a threshold.
 */
export function describeCategoricalEvidence(rule: EligibilityRule, prose: string): string[] {
  const lower = prose.toLowerCase();
  const unsupported: string[] = [];

  if (
    rule.gender !== '*' &&
    !/\b(women|woman|female|girl|male|man|men|boy|transgender)\b/.test(lower)
  ) {
    unsupported.push(`gender=${rule.gender} with no gendered wording in the prose`);
  }

  if (
    rule.requiresDisability &&
    !/(disab|divyang|handicap|blind|deaf|pwd|specially abled)/.test(lower)
  ) {
    unsupported.push('requiresDisability with no disability wording in the prose');
  }

  if (
    rule.isStudentOnly &&
    !/(student|studying|study|school|college|scholar|pupil|educat)/.test(lower)
  ) {
    unsupported.push('isStudentOnly with no education wording in the prose');
  }

  return unsupported;
}
