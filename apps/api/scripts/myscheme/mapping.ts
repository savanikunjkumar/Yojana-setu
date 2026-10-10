import {
  OCCUPATIONS,
  SCHEME_CATEGORIES,
  regionName,
  resolveRegionCode,
  type Occupation,
  type SchemeCategory,
} from '@sih/shared';

/**
 * myScheme labels each scheme with a free-form tag cloud ("Agricultural Inputs",
 * "Income Support", "Kisan") rather than a category enum, so tags plus the title
 * and summary get matched against these patterns.
 *
 * Order is significant — first match wins — and it encodes one judgement call:
 * *domain* categories rank above *demographic* ones. A loan scheme for women is
 * filed under ENTREPRENEURSHIP rather than WOMEN_AND_CHILD, because the fact that
 * it is for women is already captured precisely in the eligibility rule, whereas
 * the domain exists nowhere else. The exceptions are disability and old age,
 * which sit above the generic money categories because a citizen browsing for
 * them expects to find them there — and because seed.ts files them that way.
 */
const CATEGORY_PATTERNS: Array<{ category: SchemeCategory; pattern: RegExp }> = [
  {
    category: 'EDUCATION',
    pattern:
      /\b(scholarship|education|student|school|college|university|tuition|coaching|fellowship|hostel|literacy|vidya|shiksha|merit|exam)\b/i,
  },
  {
    category: 'HEALTHCARE',
    pattern:
      /\b(health|medical|hospital|treatment|disease|cancer|surgery|ayushman|arogya|nutrition|immunis|immuniz|medicine|dialysis)\b/i,
  },
  {
    category: 'AGRICULTURE',
    pattern:
      /\b(agricultur|farmer|kisan|crop|farm|horticultur|irrigat|seed|fertilis|fertiliz|livestock|dairy|fisher|animal husbandry|poultry|plantation|soil)\b/i,
  },
  { category: 'HOUSING', pattern: /\b(housing|awas|house|shelter|dwelling|slum|rent)\b/i },
  {
    category: 'ENERGY',
    pattern: /\b(electricity|solar|lpg|gas connection|ujjwala|power|energy|biogas|kerosene)\b/i,
  },
  {
    category: 'WATER_AND_SANITATION',
    pattern: /\b(water|sanitation|toilet|swachh|sewer|drainage|drinking water)\b/i,
  },
  {
    category: 'TRANSPORT',
    pattern: /\b(transport|bus pass|bicycle|cycle|railway|travel concession|vehicle)\b/i,
  },
  {
    category: 'SKILL_DEVELOPMENT',
    pattern:
      /\b(skill|training|apprentice|vocational|upskill|internship|capacity building|kaushal)\b/i,
  },
  {
    category: 'ENTREPRENEURSHIP',
    pattern:
      /\b(entrepreneur|startup|start-up|business|enterprise|msme|self.?employment|industry|industrial|artisan|weaver|handicraft|handloom|khadi|vendor)\b/i,
  },
  {
    category: 'EMPLOYMENT',
    pattern: /\b(employment|job|wage|labour|labor|worker|mgnrega|unemploy|placement)\b/i,
  },
  { category: 'DISABILITY_WELFARE', pattern: /\b(disab|divyang|handicap|blind|deaf|pwd)\b/i },
  {
    category: 'SENIOR_CITIZEN',
    pattern: /\b(senior citizen|old age|elderly|vay vandana|vridha|pensioner)\b/i,
  },
  {
    category: 'WOMEN_AND_CHILD',
    pattern:
      /\b(women|woman|girl|child|maternity|mother|widow|anganwadi|matru|kanya|balika|adolescent)\b/i,
  },
  {
    category: 'SOCIAL_SECURITY',
    pattern:
      /\b(pension|social security|provident|gratuity|welfare fund|accident insurance|life insurance|death insurance|family benefit)\b/i,
  },
  {
    category: 'FINANCIAL_INCLUSION',
    pattern:
      /\b(loan|credit|bank|subsidy|insurance|financial assistance|direct benefit transfer|savings|mudra|interest|collateral)\b/i,
  },
];

/**
 * Picks a category from the tag cloud, falling back to the title and summary.
 * Returns OTHER when nothing matches, and the caller logs those for review rather
 * than silently burying them.
 */
export function inferCategory(input: { tags: string[]; name: string; details: string }): {
  category: SchemeCategory;
  matchedOn: string;
} {
  const tagText = input.tags.join(' ');

  // Tags are curated by the portal, so they are the strongest signal; the title is
  // next; the free-text summary is the last resort because it mentions everything.
  for (const haystack of [tagText, input.name, input.details.slice(0, 600)]) {
    for (const { category, pattern } of CATEGORY_PATTERNS) {
      const match = haystack.match(pattern);
      if (match) return { category, matchedOn: match[0] };
    }
  }

  return { category: 'OTHER', matchedOn: '' };
}

export function isSchemeCategory(value: string): value is SchemeCategory {
  return (SCHEME_CATEGORIES as readonly string[]).includes(value);
}

const LABEL_PREFIXES = /^(government of|govt\.? of|state of|ut of|union territory of)\s+/i;

/**
 * The header label above a scheme title is either a ministry ("Ministry Of
 * Finance") or a state name ("Karnataka"). Whether it resolves to an ISO region
 * code is what distinguishes a state scheme from a central one.
 */
export function resolveScope(headerLabel: string): { state: string | null } {
  const label = headerLabel.trim();
  if (!label) return { state: null };

  const direct = resolveRegionCode(label);
  if (direct) return { state: direct };

  const stripped = label.replace(LABEL_PREFIXES, '').trim();
  const viaPrefix = resolveRegionCode(stripped);
  if (viaPrefix) return { state: viaPrefix };

  return { state: null };
}

/**
 * State schemes show the state name where central schemes show a ministry, so the
 * implementing department has to come out of the summary prose instead. The
 * fallback is deliberately generic rather than a guess at a department name.
 */
export function resolveMinistry(input: {
  headerLabel: string;
  state: string | null;
  details: string;
}): string {
  if (input.state === null && input.headerLabel.trim()) {
    return input.headerLabel.trim();
  }

  const implementedBy = input.details.match(
    /implemented by\s+(?:the\s+)?([^,.;]{4,120}?)(?:,|\.|;|\s+aims|\s+with the|\s+to\s+provide)/i,
  );
  if (implementedBy?.[1]) {
    const candidate = implementedBy[1].trim();
    if (candidate.length >= 4) return candidate;
  }

  if (input.state) return `Government of ${regionName(input.state)}`;
  return input.headerLabel.trim() || 'Government of India';
}

/** Keyword patterns for the deterministic normaliser's occupation extraction. */
export const OCCUPATION_PATTERNS: Array<{ occupation: Occupation; pattern: RegExp }> = [
  {
    occupation: 'FARMER',
    pattern: /\b(farmer|cultivator|landholding farmer|kisan|agriculturist)\b/i,
  },
  {
    occupation: 'AGRICULTURAL_LABOURER',
    pattern: /\b(agricultural labour|farm labour|agri.?labour)\b/i,
  },
  {
    occupation: 'DAILY_WAGE_LABOURER',
    pattern:
      /\b(daily wage|casual labour|unorganised worker|unorganized worker|construction worker)\b/i,
  },
  {
    occupation: 'ARTISAN',
    pattern: /\b(artisan|craftsperson|craftsmen|handicraft|potter|blacksmith|carpenter)\b/i,
  },
  { occupation: 'WEAVER', pattern: /\b(weaver|handloom|powerloom)\b/i },
  { occupation: 'FISHERMAN', pattern: /\b(fisher(man|men|folk)?|fishing)\b/i },
  {
    occupation: 'LIVESTOCK_REARER',
    pattern: /\b(livestock|dairy farmer|cattle rearer|animal husbandry|poultry farmer)\b/i,
  },
  { occupation: 'STREET_VENDOR', pattern: /\b(street vendor|hawker|rehri|patri)\b/i },
  {
    occupation: 'SMALL_BUSINESS_OWNER',
    pattern: /\b(small business|shopkeeper|micro enterprise|msme owner|trader)\b/i,
  },
  { occupation: 'SELF_EMPLOYED', pattern: /\b(self.?employed|own account worker)\b/i },
  { occupation: 'SALARIED_PRIVATE', pattern: /\b(salaried|private sector employee)\b/i },
  {
    occupation: 'GOVERNMENT_EMPLOYEE',
    pattern: /\b(government employee|govt\.? servant|public servant)\b/i,
  },
  { occupation: 'STUDENT', pattern: /\b(student|pupil|scholar|studying|enrolled in)\b/i },
  { occupation: 'HOMEMAKER', pattern: /\b(homemaker|housewife)\b/i },
  { occupation: 'UNEMPLOYED', pattern: /\b(unemployed|jobless|job.?seeker)\b/i },
  { occupation: 'RETIRED', pattern: /\b(retired|superannuated|ex.?serviceman|veteran)\b/i },
];

export function isOccupation(value: string): value is Occupation {
  return (OCCUPATIONS as readonly string[]).includes(value);
}

/**
 * Occupation words as they appear in scheme prose, mapped onto our enum.
 *
 * A term may map to several values. "Fish vendor" is arguably a FISHERMAN and arguably
 * a STREET_VENDOR, and an applicant could reasonably describe themselves as either —
 * so both are listed. The rule treats `occupation` as an OR, so listing both is the
 * inclusive reading, which is the correct way to resolve genuine ambiguity here.
 */
const OCCUPATION_TERMS: Array<{ pattern: RegExp; occupations: Occupation[] }> = [
  { pattern: /\bfish (?:vendor|seller|monger)\b/i, occupations: ['FISHERMAN', 'STREET_VENDOR'] },
  { pattern: /\bfisher(?:man|woman|men|folk)\b/i, occupations: ['FISHERMAN'] },
  {
    pattern:
      /\b(?:cobbler|potter|blacksmith|carpenter|goldsmith|mason|tailor|barber|craftsperson|craftsman|artisan)\b/i,
    occupations: ['ARTISAN'],
  },
  { pattern: /\b(?:weaver|handloom worker|powerloom worker)\b/i, occupations: ['WEAVER'] },
  {
    pattern: /\bconstruction worker|building (?:and other )?construction worker\b/i,
    occupations: ['DAILY_WAGE_LABOURER'],
  },
  { pattern: /\b(?:street vendor|hawker|rehri patri)\b/i, occupations: ['STREET_VENDOR'] },
  { pattern: /\b(?:farmer|cultivator|agriculturist)\b/i, occupations: ['FARMER'] },
  { pattern: /\bagricultural (?:labour|worker)/i, occupations: ['AGRICULTURAL_LABOURER'] },
  {
    pattern: /\b(?:government (?:employee|servant)|govt\.? servant)\b/i,
    occupations: ['GOVERNMENT_EMPLOYEE'],
  },
  { pattern: /\b(?:ex.?serviceman|retired personnel)\b/i, occupations: ['RETIRED'] },
];

/**
 * Direct requirements on the applicant: "the applicant should be a Roadside Cobbler".
 * Only this phrasing is trusted, because it is the one construction that unambiguously
 * constrains the *applicant* rather than listing groups a scheme happens to serve.
 */
const APPLICANT_REQUIREMENT =
  /\bapplicants?\s+(?:should|must|has to|have to)\s+be\s+(?:a|an|the)?\s*([^.;\n]{0,90})/gi;

/**
 * Phrases that mean the clause enumerates ALTERNATIVES rather than one requirement.
 * "Applicants should be from the following categories: SECC families, small traders,
 * journalists, construction workers" names an occupation but does not require it —
 * tagging it would exclude everyone who qualifies by one of the other routes.
 *
 * "or" needs care. In "a traditional fisherman by birth or profession" it introduces a
 * *manner*, not another group, so treating it as a list loses a real gate. The
 * lookahead therefore ignores "or" when what follows describes how someone came to the
 * occupation, and treats every other "or" as an alternative — which yields no
 * restriction, the safe direction.
 */
const ALTERNATIVES = new RegExp(
  [
    /following categories/,
    /any one of/,
    /any of the following/,
    /\beither\b/,
    /\bor\b(?!\s+(?:by\s+)?(?:profession|birth|occupation|caste|trade|descent|heredity|vocation)\b)/,
    // Three or more commas reads as an enumeration rather than one requirement.
    /,[^,]*,[^,]*,/,
  ]
    .map((pattern) => pattern.source)
    .join('|'),
  'i',
);

/**
 * Recovers an occupation gate that the normaliser missed.
 *
 * Exists because both normalisers demonstrably get this wrong in the same direction:
 * an LLM reading "must be a registered construction worker" returned OTHER, and
 * "should be a Roadside Cobbler" came back unrestricted. Both are recoverable from the
 * prose with a much narrower rule than a general extractor can use, precisely because
 * this only looks at one sentence pattern.
 *
 * Returns null when nothing unambiguous is found, leaving the normaliser's answer
 * alone — including a deliberate wildcard.
 */
export function recoverOccupationGate(prose: string): Occupation[] | null {
  const found = new Set<Occupation>();

  for (const match of prose.matchAll(APPLICANT_REQUIREMENT)) {
    const clause = match[1] ?? '';
    if (ALTERNATIVES.test(clause)) continue;

    for (const { pattern, occupations } of OCCUPATION_TERMS) {
      if (pattern.test(clause)) {
        occupations.forEach((occupation) => found.add(occupation));
      }
    }
  }

  return found.size > 0 ? [...found].sort() : null;
}
