/**
 * Regression cases for the deterministic normaliser, every one taken from prose
 * that actually appeared on myScheme and was read wrongly. Run with:
 *
 *   npx tsx apps/api/scripts/myscheme/normalize-rules.spec.ts
 *
 * Kept as a plain script rather than a Jest suite so it runs without pulling the
 * API's test config into the scripts project.
 */
import { safeNormalizeEligibility } from '@sih/shared';
import { checkGrounding, checkPlausibility } from './grounding';
import { extractWithRules } from './normalize-rules';

interface Case {
  label: string;
  name: string;
  prose: string;
  expect: Partial<{
    minAge: number | null;
    maxAge: number | null;
    maxAnnualIncome: number | null;
    gender: string;
    socialCategory: string[];
    occupation: string[];
    maxLandHolding: number | null;
    isStudentOnly: boolean;
    requiresDisability: boolean;
  }>;
}

const CASES: Case[] = [
  {
    // Was read as an income cap of ₹4,000 — the monthly figure rather than the
    // annual one stated in the same sentence.
    label: 'monthly and annual figures in one clause',
    name: 'Scheme For Financial Assistance For Veteran Artists',
    prose: [
      'The personal income of the applicant (including the income of the spouse) must not exceed ₹4,000/- per month or an annual income of ₹48,000/-.',
      'The applicant should not be less than 60 (sixty) years of age.',
    ].join('\n'),
    expect: { maxAnnualIncome: 48_000, minAge: 60 },
  },
  {
    // Was read as an income cap of 1980, lifted from "the academic year 1980-81".
    label: 'calendar year in an income clause',
    name: 'Post Matric Scholarship Scheme For Scheduled Tribe Students',
    prose: [
      'From the academic year 1980-81, employed students whose income combined with the income of their parents/guardians does not exceed the maximum prescribed income ceiling are made eligible.',
      'Scholarships will be paid to the students whose parents/guardians’ income from all sources does not exceed ₹ 2,00,000/- per annum.',
    ].join('\n'),
    expect: { maxAnnualIncome: 200_000 },
  },
  {
    // Was read as minAge 50 from "above 50 years … is not eligible", inverting the
    // actual maximum.
    label: 'age bound inside an ineligibility clause',
    name: 'Research Grant For In-Service Faculty Members',
    prose: [
      'The age of the applicant should not be greater than 50 years.',
      '(Faculty above 50 years of age is not eligible to apply).',
    ].join('\n'),
    expect: { minAge: null, maxAge: 50 },
  },
  {
    // Was read as an SC/ST-only scheme, which would exclude the general-category
    // women it is largely built for.
    label: 'category restriction that applies only to men',
    name: 'Stand-Up India',
    prose: [
      'Finance is provided for Greenfield Enterprises.',
      'If the applicant is a male, he must be from SC / ST category.',
      'The age of the applicant must be at least 18 years.',
    ].join('\n'),
    expect: { socialCategory: ['*'], minAge: 18 },
  },
  {
    label: 'plain age range and income ceiling',
    name: 'Udyogini Scheme',
    prose: [
      'The age limit of the applicant should be between 18 and 55 years.',
      'Family income from all sources should be within Rs. 1.50 lakh per annum.',
    ].join('\n'),
    expect: { minAge: 18, maxAge: 55, maxAnnualIncome: 150_000 },
  },
  {
    label: 'acres converted to hectares',
    name: 'Land Ceiling Test Scheme',
    prose: 'The applicant should be a small farmer with land holding not exceeding 5 acres.',
    expect: { maxLandHolding: 2.0234 },
  },
  {
    // An income-tax exclusion is a disqualifier, not a ceiling.
    label: 'income tax exclusion is not an income cap',
    name: 'PM-KISAN',
    prose: [
      "All landholding farmers' families are eligible.",
      'Exclusions:',
      'All Persons who paid Income Tax in last assessment year.',
    ].join('\n'),
    expect: { maxAnnualIncome: null },
  },
  {
    label: 'women-only scheme',
    name: 'Mahila Samman Scheme',
    prose: 'The applicant must be a woman resident of the state aged 21 years or above.',
    expect: { gender: 'FEMALE', minAge: 21 },
  },
  {
    // "enrolled as a member of the Fishermen Co-operative Society" was read as a
    // student requirement, producing a fisherman who must also be studying — a rule
    // no one can satisfy, which Zod then refused outright.
    label: 'enrolment in a co-operative is not enrolment in study',
    name: 'Subsidy for the Purchase of Mechanised Boats',
    prose:
      'The applicant must have been enrolled as a member of the Fishermen Co-operative Society and be above the age of 23 years and below 60 years.',
    expect: { isStudentOnly: false, minAge: 23, maxAge: 60 },
  },
  {
    // Two monthly ceilings, no annual figure anywhere. The conversion is legitimate,
    // so the grounding check has to accept a monthly figure times twelve.
    label: 'monthly-only income ceiling converts to annual',
    name: 'Government Working Women’s Hostel',
    prose: [
      'If the applicant is in Chennai, the income of the applicant should not exceed ₹25000/- per month.',
      'If the applicant is in a district other than Chennai, the income of the applicant should not exceed ₹15000/- per month.',
    ].join('\n'),
    expect: { maxAnnualIncome: 300_000 },
  },
];

let failures = 0;

function fail(label: string, message: string, notes?: string): void {
  failures += 1;
  console.error(`FAIL  ${label}`);
  console.error(`        ${message}`);
  if (notes) console.error(`        notes: ${notes}`);
}

for (const testCase of CASES) {
  const { rule, notes } = extractWithRules({ prose: testCase.prose, name: testCase.name });

  for (const [field, wanted] of Object.entries(testCase.expect)) {
    const actual = (rule as Record<string, unknown>)[field];
    const same = Array.isArray(wanted)
      ? JSON.stringify(actual) === JSON.stringify(wanted)
      : actual === wanted;

    if (!same) {
      fail(
        testCase.label,
        `${field}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`,
        notes,
      );
    }
  }

  // Every case must also survive the gates the scraper puts in front of the database,
  // so a fix to the extractor cannot pass here and still be rejected at run time.
  const parsed = safeNormalizeEligibility(rule);
  if (!parsed.success) {
    fail(
      testCase.label,
      `Zod rejected the rule: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      notes,
    );
    continue;
  }

  const groundingFailures = [
    ...checkGrounding(parsed.data, testCase.prose),
    ...checkPlausibility(parsed.data),
  ];
  if (groundingFailures.length > 0) {
    fail(
      testCase.label,
      `grounding rejected: ${groundingFailures.map((failure) => failure.reason).join('; ')}`,
      notes,
    );
  }
}

if (failures === 0) {
  console.log(
    `ok    ${CASES.length} normaliser regression cases passed (extract + Zod + grounding)`,
  );
} else {
  console.error(`\n${failures} expectation(s) failed`);
  process.exitCode = 1;
}
