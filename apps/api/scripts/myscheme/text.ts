/** Text cleanup and Indian numeric parsing shared by extraction and grounding. */

/**
 * myScheme's rich-text fields are littered with U+FEFF (zero-width no-break
 * space) and non-breaking spaces from the CMS, which otherwise end up inside
 * stored prose and break naive regex matching.
 */
export function cleanText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/\uFEFF/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
    .trim();
}

/** Drops the section heading that myScheme renders as the first line of each block. */
export function stripHeading(text: string, heading: string): string {
  const cleaned = cleanText(text);
  const pattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\n?`, 'i');
  return cleaned.replace(pattern, '').trim();
}

export function toBulletList(text: string): string[] {
  return cleanText(text)
    .split('\n')
    .map((line) => line.replace(/^[-•*\u2022]\s*/, '').trim())
    .filter((line) => line.length > 1)
    .map((line) => line.replace(/\.$/, ''));
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

const LAKH = 100_000;
const CRORE = 10_000_000;

const MONTHLY_CONTEXT = /\b(per month|p\.?m\.?|monthly|a month)\b/i;

/**
 * Every number a piece of prose can be read as asserting, normalised to a plain
 * integer/float. "Rs. 3.50 lakh" yields both 3.5 and 350000 because either could
 * legitimately be what a downstream rule refers to.
 *
 * Unit conversions count as grounded, because the rule fields have fixed units that
 * the prose often does not use: land ceilings are stored in hectares while guidelines
 * quote acres, and income is stored per year while "₹25,000 per month" is per month.
 * Without these, a correct conversion would be rejected as a fabricated number.
 *
 * Scanned line by line so that a monthly qualifier only applies to the figures in
 * the clause that carries it.
 *
 * Commas are stripped first so Indian grouping ("2,50,000") and Western grouping
 * ("250,000") both collapse to the same number.
 */
export function collectNumbers(prose: string): Set<number> {
  const numbers = new Set<number>();

  for (const rawLine of prose.split('\n')) {
    const line = rawLine.replace(/,/g, '');
    const monthly = MONTHLY_CONTEXT.test(line);

    for (const match of line.matchAll(
      /(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|acres?|hectares?)?/gi,
    )) {
      const value = Number.parseFloat(match[1] ?? '');
      if (!Number.isFinite(value)) continue;

      numbers.add(value);

      const unit = match[2]?.toLowerCase() ?? '';
      if (unit.startsWith('lakh') || unit.startsWith('lac')) {
        numbers.add(Math.round(value * LAKH));
      } else if (unit.startsWith('crore')) {
        numbers.add(Math.round(value * CRORE));
      } else if (unit.startsWith('acre')) {
        numbers.add(Number((value * 0.404686).toFixed(4)));
      } else if (monthly) {
        numbers.add(Math.round(value * 12));
      }
    }
  }

  return numbers;
}

/** Numbers written as words, which appear in older scheme guidelines. */
const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  eighteen: 18,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
};

export function collectWordNumbers(prose: string): Set<number> {
  const found = new Set<number>();
  const lower = prose.toLowerCase();
  for (const [word, value] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) found.add(value);
  }
  return found;
}
