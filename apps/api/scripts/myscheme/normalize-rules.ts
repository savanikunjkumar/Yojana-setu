import type { Gender, Occupation, SocialCategory } from '@sih/shared';
import { OCCUPATION_PATTERNS } from './mapping';
import type { LlmExtraction } from './normalize-llm';

/**
 * Deterministic normaliser.
 *
 * Same output shape as the LLM path, produced by pattern matching instead. It is
 * measurably coarser — it will miss unusual phrasings that a model handles — but it
 * earns its place for three reasons: the whole pipeline can be exercised and tested
 * without credentials or spend, the output is reproducible so a regression is
 * visible in a diff, and it never invents a number.
 *
 * Prose is examined line by line. Scheme eligibility is written as a list of
 * conditions, and scoping each pattern to the line that mentions the relevant
 * concept avoids the classic failure of a page-wide regex pairing "18" from an age
 * clause with "lakh" from an unrelated income clause.
 */
export function extractWithRules(input: { prose: string; name: string }): LlmExtraction {
  const lines = splitConditions(input.prose);
  const notes: string[] = [];

  // Categorical criteria are read only from unconditional clauses. See
  // CONDITIONAL_CLAUSE for why.
  const plainLines = lines.filter((line) => !CONDITIONAL_CLAUSE.test(line));
  const conditionalText = lines.filter((line) => CONDITIONAL_CLAUSE.test(line)).join('\n');
  const whole = `${input.name}\n${input.prose}`;

  // The title is trustworthy for who a scheme is *for* ("Post Matric Scholarship for
  // Scheduled Tribe Students") but not for occupation, where it usually names a
  // subject rather than the applicant's job — "Veteran Artists" is a scheme about
  // artists, not a scheme requiring the applicant be retired. Occupation is
  // therefore read from the prose alone.
  const plainProse = plainLines.join('\n');
  const plainWithTitle = [input.name, ...plainLines].join('\n');

  const age = extractAgeBounds(lines);
  const income = extractIncomeCap(lines, notes);
  const land = extractLandCeiling(lines, notes);

  const rule = {
    minAge: age.min,
    maxAge: age.max,
    maxAnnualIncome: income,
    gender: relax(
      'gender',
      extractGender(plainWithTitle),
      extractGender(conditionalText),
      '*',
      notes,
    ),
    socialCategory: relaxList(
      'socialCategory',
      extractSocialCategories(plainWithTitle),
      extractSocialCategories(conditionalText),
      notes,
    ),
    occupation: relaxList(
      'occupation',
      extractOccupations(plainProse),
      extractOccupations(conditionalText),
      notes,
    ),
    // A specific state is never inferred here: the administering state is known
    // from the page header, and the caller applies it.
    states: ['*'] as string[],
    maxLandHolding: land,
    requiresDisability: DISABILITY.test(plainWithTitle),
    isStudentOnly: STUDENT_ONLY.test(plainWithTitle),
  };

  return {
    rule,
    usesDeprivationCriteria: DEPRIVATION.test(whole),
    notes: ['rule-based extraction', ...notes].join('; '),
  };
}

/**
 * Clauses that restrict only *some* applicants — "if the applicant is a male, he
 * must be from SC / ST category" (Stand-Up India), where a woman of any category
 * qualifies.
 *
 * `EligibilityRule` has no way to express a conditional, so a restriction found only
 * inside one is dropped to the wildcard and noted for review. Encoding it as
 * unconditional would exclude every general-category woman from a scheme built for
 * them; leaving it open shows the scheme to a few people who then read the real
 * rules on the department's own page.
 */
const CONDITIONAL_CLAUSE =
  /\b(if the (?:applicant|candidate|beneficiary|person|student)|if he\b|if she\b|in (?:the )?case of|provided that|except (?:for|in|where)|in respect of)\b/i;

/** Keeps an unconditional finding; downgrades a conditional-only one to the wildcard. */
function relax<T extends string>(
  field: string,
  fromPlain: T | '*',
  fromConditional: T | '*',
  wildcard: '*',
  notes: string[],
): T | '*' {
  if (fromPlain !== '*') return fromPlain;
  if (fromConditional !== '*') {
    notes.push(`${field} restriction appears only in a conditional clause — left unrestricted`);
  }
  return wildcard;
}

function relaxList(
  field: string,
  fromPlain: string[],
  fromConditional: string[],
  notes: string[],
): string[] {
  if (!fromPlain.includes('*')) return fromPlain;
  if (!fromConditional.includes('*')) {
    notes.push(`${field} restriction appears only in a conditional clause — left unrestricted`);
  }
  return ['*'];
}

/**
 * Abbreviations whose full stop must not be mistaken for the end of a sentence.
 * "within Rs. 1.50 lakh per annum" split at "Rs." leaves the ceiling phrase in one
 * fragment and the amount in the next, and the income clause stops being readable.
 */
const ABBREVIATIONS =
  /\b(Rs|No|Sr|Jr|Mr|Mrs|Ms|Dr|Smt|Shri|Govt|Ltd|Pvt|vs|etc|viz|approx|i\.e|e\.g)\./gi;
const DOT_PLACEHOLDER = '\u0000';

/** Splits prose into the individual conditions it asserts. */
function splitConditions(prose: string): string[] {
  const masked = prose.replace(ABBREVIATIONS, (match) => match.replace(/\./g, DOT_PLACEHOLDER));

  return masked
    .split(/\n|(?<=[.;])\s+/)
    .map((line) => line.split(DOT_PLACEHOLDER).join('.').trim())
    .filter((line) => line.length > 3);
}

const AGE_MENTION = /\bage|\byears?\b|\bold\b/i;

/**
 * Clauses that state who is *disqualified* rather than who qualifies. Their bounds
 * read backwards — "faculty above 50 years of age is not eligible" is a maximum age
 * of 50, but the phrase "above 50" looks like a minimum.
 *
 * Reliably inverting a negated clause is beyond pattern matching, so these lines are
 * skipped for numeric bounds entirely. Missing a bound leaves a scheme open to more
 * people than it should be, which is recoverable; inverting one silently locks out
 * exactly the people who qualify.
 */
const INELIGIBILITY_CLAUSE =
  /\b(not be eligible|not eligible|ineligible|shall not|is not entitled|debarred|disqualif)\b/i;

function extractAgeBounds(lines: string[]): { min: number | null; max: number | null } {
  let min: number | null = null;
  let max: number | null = null;

  for (const line of lines) {
    if (!AGE_MENTION.test(line)) continue;
    if (INELIGIBILITY_CLAUSE.test(line)) continue;

    // "between 18 and 55 years", "aged between 18 years and 70 years", "18 to 40 years"
    const range = line.match(
      /\b(?:between|from|aged)\D{0,20}?(\d{1,3})\s*(?:years?)?\s*(?:and|to|-|–)\s*(\d{1,3})\D{0,15}?years?/i,
    );
    if (range) {
      const low = Number(range[1]);
      const high = Number(range[2]);
      if (isAge(low) && isAge(high) && low <= high) {
        min = min === null ? low : Math.max(min, low);
        max = max === null ? high : Math.min(max, high);
        continue;
      }
    }

    // `\D{0,15}?` between the number and "years" tolerates the spelled-out
    // parenthetical that official prose likes — "60 (sixty) years of age".
    const lower = line.match(
      /\b(?:minimum age|minimum of|at least|not\s+(?:be\s+)?less than|not\s+(?:be\s+)?below|above|over|completed|attained|aged)\D{0,20}?(\d{1,3})\D{0,15}?years?/i,
    );
    if (lower) {
      const value = Number(lower[1]);
      if (isAge(value)) min = min === null ? value : Math.max(min, value);
    }

    const orAbove = line.match(
      /\b(\d{1,3})\s*years?\s*(?:of age\s*)?(?:and|or)\s*(?:above|older|more)/i,
    );
    if (orAbove) {
      const value = Number(orAbove[1]);
      if (isAge(value)) min = min === null ? value : Math.max(min, value);
    }

    const upper = line.match(
      /\b(?:maximum age|not (?:be )?(?:more than|greater than|exceed(?:ing)?|over|above)|below|under|up ?to|less than)\D{0,20}?(\d{1,3})\s*years?/i,
    );
    if (upper) {
      const value = Number(upper[1]);
      if (isAge(value)) max = max === null ? value : Math.min(max, value);
    }
  }

  // A contradictory pair means the patterns matched unrelated clauses; discarding
  // both is safer than persisting a rule that can never match.
  if (min !== null && max !== null && min > max) return { min: null, max: null };
  return { min, max };
}

function isAge(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 120;
}

const INCOME_MENTION = /\bincome\b/i;
const INCOME_EXCLUSION = /\b(income tax|tax ?payer|assessee|it return)\b/i;
const CEILING_PHRASE =
  /\b(not exceed(?:ing)?|does not exceed|less than|below|within|up ?to|upto|maximum|max\.?|ceiling|limit|shall not be more than)\b/i;
const MONTHLY = /\b(per month|p\.?m\.?|monthly|a month)\b/i;
const ANNUAL = /\b(per annum|p\.?a\.?|annual(?:ly)?|per year|a year)\b/i;

/**
 * Reads an annual income ceiling out of the conditions.
 *
 * Three failure modes seen on real scheme pages drive the rules below:
 *
 *   - "From the academic year 1980-81, … income … does not exceed the maximum
 *     prescribed ceiling" — a clause that mentions income and a ceiling but whose
 *     only number is a *year*. Hence: no bare year-shaped number without a currency
 *     marker, and no bare number too small to be an annual household income.
 *
 *   - "must not exceed ₹4,000/- per month or an annual income of ₹48,000/-" — the
 *     first figure is monthly. Hence: monthly amounts are multiplied by twelve.
 *
 *   - a page quoting several ceilings for different beneficiary groups. Hence: the
 *     highest is taken, matching this project's bias that wrongly including someone
 *     who then reads the real rules beats wrongly excluding them.
 */
function extractIncomeCap(lines: string[], notes: string[]): number | null {
  let cap: number | null = null;

  for (const line of lines) {
    if (!INCOME_MENTION.test(line)) continue;
    if (INELIGIBILITY_CLAUSE.test(line)) continue;

    // "Income tax payers are excluded" is a disqualifier, not a ceiling.
    if (INCOME_EXCLUSION.test(line) && !/\b(annual|family|household)\b/i.test(line)) {
      notes.push('ignored an income-tax exclusion clause');
      continue;
    }

    if (!CEILING_PHRASE.test(line)) continue;

    const amount = pickAnnualAmount(line, notes);
    if (amount === null) continue;

    cap = cap === null ? amount : Math.max(cap, amount);
  }

  return cap;
}

interface AmountCandidate {
  value: number;
  hasCurrency: boolean;
  scaled: boolean;
}

/** Rupee figures in a line, normalised to an annual amount. */
function pickAnnualAmount(line: string, notes: string[]): number | null {
  const normalized = line.replace(/,/g, '');
  const candidates: AmountCandidate[] = [];

  for (const match of normalized.matchAll(
    /(rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?)?/gi,
  )) {
    const value = Number.parseFloat(match[2] ?? '');
    if (!Number.isFinite(value)) continue;

    const hasCurrency = Boolean(match[1]);
    const unit = match[3]?.toLowerCase() ?? '';

    if (unit.startsWith('lakh') || unit.startsWith('lac')) {
      candidates.push({ value: Math.round(value * 100_000), hasCurrency, scaled: true });
      continue;
    }
    if (unit.startsWith('crore')) {
      candidates.push({ value: Math.round(value * 10_000_000), hasCurrency, scaled: true });
      continue;
    }

    // A bare number that looks like a calendar year is a date, not an amount.
    const yearShaped = Number.isInteger(value) && value >= 1900 && value <= 2100;
    if (!hasCurrency && (yearShaped || value < 10_000)) continue;

    candidates.push({ value: Math.round(value), hasCurrency, scaled: false });
  }

  if (candidates.length === 0) return null;

  // A line stating both a monthly and an annual figure gets read as annual; a purely
  // monthly line is converted.
  const isMonthly = MONTHLY.test(line);
  const isAnnual = ANNUAL.test(line);

  const values = candidates.map((candidate) => {
    if (isMonthly && !isAnnual && !candidate.scaled) {
      return candidate.value * 12;
    }
    return candidate.value;
  });

  if (isMonthly && !isAnnual) {
    notes.push('converted a monthly income figure to annual');
  }

  const best = Math.max(...values);
  return best >= 10_000 ? best : null;
}

const LAND_MENTION = /\b(land|holding|hectare|acre|bigha)\b/i;

function extractLandCeiling(lines: string[], notes: string[]): number | null {
  for (const line of lines) {
    if (!LAND_MENTION.test(line)) continue;
    if (
      !/\b(not exceed(?:ing)?|less than|below|within|up ?to|maximum|upto|limit|ceiling)\b/i.test(
        line,
      )
    ) {
      continue;
    }

    const hectares = line.match(/(\d+(?:\.\d+)?)\s*hectares?/i);
    if (hectares) return Number.parseFloat(hectares[1] ?? '');

    const acres = line.match(/(\d+(?:\.\d+)?)\s*acres?/i);
    if (acres) {
      const converted = Number((Number.parseFloat(acres[1] ?? '') * 0.404686).toFixed(4));
      notes.push(`converted ${acres[1]} acres to ${converted} hectares`);
      return converted;
    }
  }

  return null;
}

const FEMALE_ONLY =
  /\b(women|woman|female|girls?|widows?|mother|maternity|pregnant|lactating|kanya|balika|mahila)\b/i;
const MALE_ONLY = /\b(men only|male only|boys? only)\b/i;
const TRANSGENDER = /\btransgender|third gender\b/i;

function extractGender(text: string): Gender | '*' {
  if (TRANSGENDER.test(text)) return 'TRANSGENDER';
  if (MALE_ONLY.test(text)) return 'MALE';

  // Only treat female wording as a restriction when no male wording appears, so a
  // scheme that merely mentions "men and women" is not narrowed to women.
  if (FEMALE_ONLY.test(text) && !/\b(men|male|boys?|husband|father)\b/i.test(text)) {
    return 'FEMALE';
  }

  return '*';
}

const CATEGORY_PATTERNS: Array<{ category: SocialCategory; pattern: RegExp }> = [
  { category: 'SC', pattern: /\b(scheduled caste|\bsc\b|dalit)\b/i },
  { category: 'ST', pattern: /\b(scheduled tribe|\bst\b|tribal|adivasi)\b/i },
  { category: 'OBC', pattern: /\b(other backward class|\bobc\b|backward class)\b/i },
  { category: 'MINORITY', pattern: /\b(minorit|muslim|christian|sikh|buddhist|jain|parsi)\b/i },
  { category: 'EWS', pattern: /\b(economically weaker section|\bews\b)\b/i },
  { category: 'GENERAL', pattern: /\bgeneral category\b/i },
];

function extractSocialCategories(text: string): string[] {
  const found = CATEGORY_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ category }) => category,
  );
  return found.length > 0 ? [...new Set(found)].sort() : ['*'];
}

function extractOccupations(text: string): string[] {
  const found: Occupation[] = [];
  for (const { occupation, pattern } of OCCUPATION_PATTERNS) {
    if (pattern.test(text)) found.push(occupation);
  }

  // A long list means the patterns are firing on incidental mentions rather than a
  // genuine restriction, so fall back to no restriction.
  if (found.length === 0 || found.length > 4) return ['*'];
  return [...new Set(found)].sort();
}

const DISABILITY = /\b(disab|divyang|handicap|blind|deaf|specially abled|\bpwd\b|udid)\b/i;

/**
 * Requires an education context around the verb. Bare "enrolled" and "pursuing"
 * matched things like "enrolled as a member of the Fishermen Co-operative Society",
 * which produced a fisherman-only scheme that also demanded the applicant be a
 * student — a rule nobody could satisfy, and one Zod rightly refused.
 */
const STUDENT_ONLY = new RegExp(
  [
    /\bstudents?\b/,
    /\bstudying\b/,
    /\bscholarship\b/,
    /\bpursuing\b(?=[^.]{0,40}\b(course|degree|study|studies|education|programme|program|diploma)\b)/,
    /\benrol(?:led|ment)?\b(?=[^.]{0,40}\b(school|college|university|course|institution|class|study|studies|education)\b)/,
    /\badmitted (?:to|in)\b(?=[^.]{0,40}\b(school|college|university|course|institution|class)\b)/,
    /\b(class|standard)\s+(?:\d|[ivx]+)\b/,
  ]
    .map((pattern) => pattern.source)
    .join('|'),
  'i',
);
export const DEPRIVATION =
  /\b(secc|socio.?economic caste census|\bbpl\b|below poverty line|antyodaya|\baay\b|priority household|deprivation|poor household|ration card holder)\b/i;
