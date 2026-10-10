/**
 * Regression cases for `recoverOccupationGate`, all taken from prose that shipped in
 * the database. Run with:
 *
 *   npm run scrape:test:occupation
 *
 * Half of these assert that a gate IS recovered; the other half assert that a
 * deliberate wildcard is LEFT ALONE. The second half matters more — the easy way to
 * "fix" missed occupation tags is a keyword matcher that then wrongly restricts every
 * scheme merely mentioning farmers, locking out the people it was meant to include.
 */
import { recoverOccupationGate } from './mapping';

interface Case {
  label: string;
  prose: string;
  /** null = must stay as the normaliser left it (no recovery). */
  expect: string[] | null;
}

const CASES: Case[] = [
  // --- must recover: an unambiguous requirement on the applicant -----------------
  {
    label: 'roadside cobbler → ARTISAN (was left unrestricted)',
    prose:
      'The applicant should be a citizen of India. The applicant should be a Roadside Cobbler identified by the Gram Panchayat. The applicant should be a permanent resident of Maharashtra State.',
    expect: ['ARTISAN'],
  },
  {
    label: 'registered construction worker → DAILY_WAGE_LABOURER (was tagged OTHER)',
    prose:
      'The applicant must be a native of the Rajasthan state. The applicant must be a registered construction worker for 3 years.',
    expect: ['DAILY_WAGE_LABOURER'],
  },
  {
    label: 'fish vendor spans two enum values (was left unrestricted)',
    prose:
      'The applicant should be a Fish Vendor registered with the Department of Fisheries, Government of Goa.',
    expect: ['FISHERMAN', 'STREET_VENDOR'],
  },
  {
    label: 'traditional fisherman',
    prose:
      'The applicant should be a traditional fisherman by birth or profession. The applicant should be a resident of Goa.',
    expect: ['FISHERMAN'],
  },

  // --- must NOT recover: alternatives, or somebody else's occupation -------------
  {
    label: 'farmers AND landless persons — not farmer-only',
    prose:
      'Farmers belonging to all categories like general/SC/ST/BPL/Women and Landless persons of Himachal Pradesh are eligible. Training in skills of goat husbandry is mandatory for all applicants.',
    expect: null,
  },
  {
    label: 'a list of qualifying categories, one of which is an occupation',
    prose:
      'Residents of Punjab. Applicants should be from the following categories SECC 2011 data families, Smart Ration Card holder families, J-Form holder farmers, Small traders registered with Excise & Taxation Department, Small & Marginal Farmers, Accredited Journalist and Construction workers registered with the Welfare Board.',
    expect: null,
  },
  {
    label: '"any one of the following" including artisans',
    prose:
      'Any one of the following can avail loan under the scheme: School/College dropouts, Individual entrepreneur, Trade Professionals, Artisan, Passed out candidates from any technical institute.',
    expect: null,
  },
  {
    label: 'an occupation named only as an exclusion',
    prose:
      "All landholding farmers' families are eligible. Exclusions: All serving or retired government employees shall not be eligible.",
    expect: null,
  },
  {
    label: 'prose with no occupation wording at all',
    prose: 'The applicant should be a permanent resident of the State and above 60 years of age.',
    expect: null,
  },
];

let failures = 0;

for (const testCase of CASES) {
  const actual = recoverOccupationGate(testCase.prose);
  const same = JSON.stringify(actual) === JSON.stringify(testCase.expect);

  if (!same) {
    failures += 1;
    console.error(`FAIL  ${testCase.label}`);
    console.error(
      `        expected ${JSON.stringify(testCase.expect)}, got ${JSON.stringify(actual)}`,
    );
  }
}

if (failures === 0) {
  console.log(`ok    ${CASES.length} occupation-recovery cases passed`);
} else {
  console.error(`\n${failures} case(s) failed`);
  process.exitCode = 1;
}
