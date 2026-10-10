import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  normalizeEligibility,
  type ApplicationStatus,
  type EligibilityRuleInput,
  type Gender,
  type IncomeBracket,
  type Occupation,
  type SchemeCategory,
  type SocialCategory,
} from '@sih/shared';

/**
 * ============================================================================
 * Seed data
 * ============================================================================
 *
 * A demo-ready slice of real central and state schemes, chosen so that between
 * them they exercise every eligibility criterion the matcher supports: age
 * ranges, income caps, gender, social category, occupation, state residence,
 * land ceilings, disability and student status.
 *
 * ---------------------------------------------------------------------------
 * NOTE ON DATA ACCURACY
 * Benefit amounts and thresholds are transcribed from public scheme guidelines
 * and are correct to the best of our reading, but they change with every budget
 * and several schemes select beneficiaries through SECC deprivation criteria
 * rather than a plain income cap. Rules marked `PROXY` below approximate such
 * criteria with an income ceiling so the demo behaves sensibly. Before this is
 * ever put in front of citizens, every rule must be re-verified against
 * `sourceUrl` — which is exactly what the scraper is for.
 * ---------------------------------------------------------------------------
 *
 * The seed is idempotent: IDs are derived from a scheme's natural key, so
 * re-running updates rows in place and any applications referencing them survive.
 */

const prisma = new PrismaClient();

interface SchemeSeed {
  name: string;
  ministry: string;
  /** ISO 3166-2:IN code of the administering state; null for central schemes. */
  state: string | null;
  category: SchemeCategory;
  benefitText: string;
  applicationUrl: string;
  sourceUrl: string;
  requiredDocuments: string[];
  /** Partial rule — `normalizeEligibility()` fills in the wildcards and nulls. */
  eligibility: EligibilityRuleInput;
}

const SCHEMES: SchemeSeed[] = [
  {
    name: 'Pradhan Mantri Kisan Samman Nidhi (PM-KISAN)',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    state: null,
    category: 'AGRICULTURE',
    benefitText:
      '₹6,000 per year paid as three equal instalments of ₹2,000 directly into the bank ' +
      'account of a landholding farmer family. Institutional landholders, income-tax payers ' +
      'and serving government employees are excluded.',
    applicationUrl: 'https://pmkisan.gov.in/RegistrationFormNew.aspx',
    sourceUrl: 'https://pmkisan.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Land ownership record (khatauni / khasra)',
      'Bank account passbook',
      'Mobile number linked to Aadhaar',
    ],
    eligibility: { occupation: ['FARMER'], minAge: 18 },
  },
  {
    name: 'Pradhan Mantri Awas Yojana – Urban 2.0',
    ministry: 'Ministry of Housing & Urban Affairs',
    state: null,
    category: 'HOUSING',
    benefitText:
      'Central assistance of up to ₹2.5 lakh towards constructing or buying a house, or an ' +
      'interest subsidy on a home loan, for economically weaker section families in urban areas.',
    applicationUrl: 'https://pmay-urban.gov.in/',
    sourceUrl: 'https://pmay-urban.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Income certificate',
      'Proof of urban residence',
      'Bank account details',
      'Affidavit confirming no pucca house is owned in India',
    ],
    // EWS ceiling of ₹3 lakh per annum, as published for PMAY-U 2.0.
    eligibility: { maxAnnualIncome: 300_000, minAge: 18 },
  },
  {
    name: 'Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (PM-JAY)',
    ministry: 'Ministry of Health & Family Welfare',
    state: null,
    category: 'HEALTHCARE',
    benefitText:
      '₹5 lakh per family per year of cashless secondary and tertiary hospital treatment at ' +
      'empanelled public and private hospitals, with no cap on family size or age.',
    applicationUrl: 'https://beneficiary.nha.gov.in/',
    sourceUrl: 'https://nha.gov.in/PM-JAY',
    requiredDocuments: ['Aadhaar card', 'Ration card', 'Family identification details'],
    // PROXY: PM-JAY selects families through SECC 2011 deprivation criteria, not an
    // income ceiling. The cap below stands in for that until the scraper can carry
    // deprivation categories.
    eligibility: { maxAnnualIncome: 300_000 },
  },
  {
    name: 'Ayushman Vay Vandana (PM-JAY cover for senior citizens)',
    ministry: 'Ministry of Health & Family Welfare',
    state: null,
    category: 'SENIOR_CITIZEN',
    benefitText:
      '₹5 lakh of free hospital cover per year for every citizen aged 70 and above, ' +
      'irrespective of income, on top of any existing family PM-JAY entitlement.',
    applicationUrl: 'https://beneficiary.nha.gov.in/',
    sourceUrl: 'https://nha.gov.in/PM-JAY',
    requiredDocuments: ['Aadhaar card showing date of birth'],
    eligibility: { minAge: 70 },
  },
  {
    name: 'National Means-cum-Merit Scholarship (NMMSS)',
    ministry: 'Ministry of Education',
    state: null,
    category: 'EDUCATION',
    benefitText:
      '₹12,000 per year for students of classes 9 to 12 studying in government, local body ' +
      'or government-aided schools, awarded on a selection test.',
    applicationUrl: 'https://scholarships.gov.in/',
    sourceUrl: 'https://scholarships.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Parental income certificate',
      'Class 8 mark sheet',
      'School bonafide certificate',
      'Bank account in the student’s name',
    ],
    eligibility: {
      minAge: 13,
      maxAge: 18,
      maxAnnualIncome: 350_000,
      isStudentOnly: true,
      occupation: ['STUDENT'],
    },
  },
  {
    name: 'Post Matric Scholarship for Scheduled Caste Students',
    ministry: 'Ministry of Social Justice & Empowerment',
    state: null,
    category: 'EDUCATION',
    benefitText:
      'Full tuition reimbursement plus a monthly maintenance allowance for Scheduled Caste ' +
      'students in recognised post-matriculation courses.',
    applicationUrl: 'https://scholarships.gov.in/',
    sourceUrl: 'https://socialjustice.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Caste certificate',
      'Parental income certificate',
      'Previous year mark sheet',
      'Institution admission letter',
    ],
    eligibility: {
      socialCategory: ['SC'],
      maxAnnualIncome: 250_000,
      minAge: 15,
      isStudentOnly: true,
      occupation: ['STUDENT'],
    },
  },
  {
    name: 'Sukanya Samriddhi Yojana',
    ministry: 'Ministry of Finance',
    state: null,
    category: 'WOMEN_AND_CHILD',
    benefitText:
      'A small savings account for a girl child under 10, carrying a government-declared ' +
      'interest rate with tax-free interest and maturity, opened by a parent or guardian.',
    applicationUrl: 'https://www.indiapost.gov.in/Financial/pages/content/sukanya-samriddhi.aspx',
    sourceUrl: 'https://www.nsiindia.gov.in/',
    requiredDocuments: [
      'Birth certificate of the girl child',
      'Aadhaar and PAN of the parent or guardian',
      'Address proof',
    ],
    eligibility: { gender: 'FEMALE', maxAge: 10 },
  },
  {
    name: 'PM Vishwakarma',
    ministry: 'Ministry of Micro, Small and Medium Enterprises',
    state: null,
    category: 'SKILL_DEVELOPMENT',
    benefitText:
      'Recognition as a traditional artisan, skill training with a ₹500 daily stipend, a ' +
      '₹15,000 toolkit incentive, and collateral-free credit of ₹1 lakh followed by ₹2 lakh at ' +
      '5% interest.',
    applicationUrl: 'https://pmvishwakarma.gov.in/',
    sourceUrl: 'https://pmvishwakarma.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Bank account details',
      'Proof of practising one of the notified trades',
    ],
    eligibility: { minAge: 18, occupation: ['ARTISAN', 'WEAVER'] },
  },
  {
    name: 'PM Street Vendor’s AtmaNirbhar Nidhi (PM SVANidhi)',
    ministry: 'Ministry of Housing & Urban Affairs',
    state: null,
    category: 'FINANCIAL_INCLUSION',
    benefitText:
      'Collateral-free working capital loan of ₹10,000, rising to ₹20,000 and then ₹50,000 on ' +
      'timely repayment, with a 7% interest subsidy and cashback on digital transactions.',
    applicationUrl: 'https://pmsvanidhi.mohua.gov.in/',
    sourceUrl: 'https://pmsvanidhi.mohua.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Certificate of vending or letter of recommendation from the urban local body',
      'Bank account details',
    ],
    eligibility: { minAge: 18, occupation: ['STREET_VENDOR'] },
  },
  {
    name: 'Atal Pension Yojana',
    ministry: 'Ministry of Finance',
    state: null,
    category: 'SOCIAL_SECURITY',
    benefitText:
      'A guaranteed monthly pension between ₹1,000 and ₹5,000 from the age of 60, based on the ' +
      'contribution chosen at enrolment. Income-tax payers are not eligible to join.',
    applicationUrl: 'https://npscra.nsdl.co.in/scheme-details.php',
    sourceUrl: 'https://www.pfrda.org.in/',
    requiredDocuments: ['Aadhaar card', 'Savings bank account', 'Mobile number'],
    eligibility: { minAge: 18, maxAge: 40 },
  },
  {
    name: 'Indira Gandhi National Old Age Pension Scheme (IGNOAPS)',
    ministry: 'Ministry of Rural Development',
    state: null,
    category: 'SENIOR_CITIZEN',
    benefitText:
      'A central pension of ₹200 per month from age 60 and ₹500 per month from age 80, for ' +
      'people from below-poverty-line households. Most states add a top-up to this amount.',
    applicationUrl: 'https://nsap.nic.in/',
    sourceUrl: 'https://nsap.nic.in/',
    requiredDocuments: ['Aadhaar card', 'Age proof', 'BPL card', 'Bank account details'],
    // PROXY: eligibility is BPL status, approximated here by an income ceiling.
    eligibility: { minAge: 60, maxAnnualIncome: 100_000 },
  },
  {
    name: 'Indira Gandhi National Disability Pension Scheme (IGNDPS)',
    ministry: 'Ministry of Rural Development',
    state: null,
    category: 'DISABILITY_WELFARE',
    benefitText:
      'A monthly pension for people aged 18 and above living with a severe or multiple ' +
      'disability of 80% or more, from a below-poverty-line household.',
    applicationUrl: 'https://nsap.nic.in/',
    sourceUrl: 'https://nsap.nic.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Disability certificate (UDID)',
      'BPL card',
      'Bank account details',
    ],
    // PROXY: BPL status approximated by an income ceiling.
    eligibility: { minAge: 18, requiresDisability: true, maxAnnualIncome: 100_000 },
  },
  {
    name: 'Pradhan Mantri Matru Vandana Yojana (PMMVY)',
    ministry: 'Ministry of Women & Child Development',
    state: null,
    category: 'WOMEN_AND_CHILD',
    benefitText:
      '₹5,000 in instalments to a pregnant woman or nursing mother for her first living child, ' +
      'and ₹6,000 for a second child if that child is a girl.',
    applicationUrl: 'https://pmmvy.wcd.gov.in/',
    sourceUrl: 'https://wcd.gov.in/schemes/pradhan-mantri-matru-vandana-yojana',
    requiredDocuments: [
      'Aadhaar card',
      'Mother and Child Protection card',
      'Bank account in the mother’s name',
    ],
    eligibility: { gender: 'FEMALE', minAge: 19, maxAge: 49 },
  },
  {
    name: 'Pradhan Mantri Ujjwala Yojana (PMUY)',
    ministry: 'Ministry of Petroleum & Natural Gas',
    state: null,
    category: 'ENERGY',
    benefitText:
      'A free LPG connection issued in the name of an adult woman of the household, including ' +
      'a deposit-free cylinder, the first refill and a stove.',
    applicationUrl: 'https://www.pmuy.gov.in/',
    sourceUrl: 'https://www.pmuy.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Ration card or state-issued proof of a poor household',
      'Bank account details',
    ],
    // PROXY: targets adult women of poor households identified via SECC / AAY lists.
    eligibility: { gender: 'FEMALE', minAge: 18, maxAnnualIncome: 100_000 },
  },
  {
    name: 'Mukhyamantri Kanya Utthan Yojana',
    ministry: 'Department of Education, Government of Bihar',
    state: 'IN-BR',
    category: 'EDUCATION',
    benefitText:
      'Staged financial assistance to girls in Bihar across their schooling, including a ' +
      'payment on passing intermediate and a further payment on graduation.',
    applicationUrl: 'https://medhasoft.bih.nic.in/',
    sourceUrl: 'https://state.bihar.gov.in/educationbihar/',
    requiredDocuments: [
      'Aadhaar card',
      'Bihar residence certificate',
      'Bank account in the student’s name',
      'Mark sheet of the qualifying examination',
    ],
    eligibility: {
      gender: 'FEMALE',
      states: ['IN-BR'],
      minAge: 12,
      maxAge: 25,
      isStudentOnly: true,
      occupation: ['STUDENT'],
    },
  },
  {
    name: 'Mukhyamantri Majhi Ladki Bahin Yojana',
    ministry: 'Women & Child Development Department, Government of Maharashtra',
    state: 'IN-MH',
    category: 'WOMEN_AND_CHILD',
    benefitText:
      '₹1,500 per month transferred to eligible women resident in Maharashtra whose family ' +
      'income is within the prescribed ceiling.',
    applicationUrl: 'https://ladakibahin.maharashtra.gov.in/',
    sourceUrl: 'https://womenchild.maharashtra.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Maharashtra domicile certificate',
      'Income certificate or ration card',
      'Bank account linked to Aadhaar',
    ],
    eligibility: {
      gender: 'FEMALE',
      states: ['IN-MH'],
      minAge: 21,
      maxAge: 65,
      maxAnnualIncome: 250_000,
    },
  },
  {
    name: 'Rythu Bandhu (Farmer Investment Support Scheme)',
    ministry: 'Department of Agriculture, Government of Telangana',
    state: 'IN-TG',
    category: 'AGRICULTURE',
    benefitText:
      'Per-acre investment support paid to land-owning farmers ahead of each cropping season, ' +
      'to cover seed, fertiliser and other input costs.',
    applicationUrl: 'https://rythubandhu.telangana.gov.in/',
    sourceUrl: 'https://agris.telangana.gov.in/',
    requiredDocuments: [
      'Aadhaar card',
      'Pattadar passbook',
      'Bank account details',
      'Telangana residence proof',
    ],
    eligibility: { states: ['IN-TG'], occupation: ['FARMER'], minAge: 18 },
  },
  {
    name: 'Sarva Shiksha / Free Bicycle Scheme for Girl Students',
    ministry: 'Department of School Education, Government of Tamil Nadu',
    state: 'IN-TN',
    category: 'EDUCATION',
    benefitText:
      'A free bicycle for girl students entering higher secondary school, to remove distance ' +
      'as a reason for dropping out.',
    applicationUrl: 'https://tnschools.gov.in/',
    sourceUrl: 'https://tnschools.gov.in/',
    requiredDocuments: ['School identity card', 'Aadhaar card', 'Tamil Nadu residence proof'],
    eligibility: {
      states: ['IN-TN'],
      gender: 'FEMALE',
      minAge: 14,
      maxAge: 19,
      isStudentOnly: true,
      occupation: ['STUDENT'],
    },
  },
];

interface ApplicantSeed {
  key: string;
  age: number | null;
  gender: Gender | null;
  incomeBracket: IncomeBracket | null;
  occupation: Occupation | null;
  state: string | null;
  district: string | null;
  socialCategory: SocialCategory | null;
  /** Hectares. */
  landHolding: number | null;
  isStudent: boolean | null;
  hasDisability: boolean | null;
}

/**
 * Demo personas. Between them they cover a fully answered profile, a partially
 * answered one (to show UNKNOWN handling), and profiles that hit the state,
 * disability and student criteria.
 */
const APPLICANTS: ApplicantSeed[] = [
  {
    key: 'ramesh-bihar-farmer',
    age: 34,
    gender: 'MALE',
    incomeBracket: 'INR_1L_TO_2_5L',
    occupation: 'FARMER',
    state: 'IN-BR',
    district: 'Gaya',
    socialCategory: 'OBC',
    landHolding: 1.2,
    isStudent: false,
    hasDisability: false,
  },
  {
    key: 'sunita-maharashtra-homemaker',
    age: 28,
    gender: 'FEMALE',
    incomeBracket: 'BELOW_50K',
    occupation: 'HOMEMAKER',
    state: 'IN-MH',
    district: 'Nanded',
    socialCategory: 'GENERAL',
    landHolding: null,
    isStudent: false,
    hasDisability: false,
  },
  {
    key: 'priya-up-student',
    age: 16,
    gender: 'FEMALE',
    incomeBracket: 'BELOW_50K',
    occupation: 'STUDENT',
    state: 'IN-UP',
    district: 'Varanasi',
    socialCategory: 'SC',
    landHolding: null,
    isStudent: true,
    hasDisability: false,
  },
  {
    key: 'anil-tamilnadu-senior',
    age: 72,
    gender: 'MALE',
    incomeBracket: 'BELOW_50K',
    occupation: 'RETIRED',
    state: 'IN-TN',
    district: 'Madurai',
    socialCategory: 'GENERAL',
    landHolding: 0,
    isStudent: false,
    hasDisability: true,
  },
  {
    // Deliberately sparse: exercises the UNKNOWN path and `nextQuestion`.
    key: 'partial-voice-session',
    age: null,
    gender: null,
    incomeBracket: null,
    occupation: 'DAILY_WAGE_LABOURER',
    state: 'IN-RJ',
    district: null,
    socialCategory: null,
    landHolding: null,
    isStudent: null,
    hasDisability: null,
  },
];

interface ApplicationSeed {
  applicantKey: string;
  schemeName: string;
  schemeState: string | null;
  status: ApplicationStatus;
  notes: string | null;
}

const APPLICATIONS: ApplicationSeed[] = [
  {
    applicantKey: 'ramesh-bihar-farmer',
    schemeName: 'Pradhan Mantri Kisan Samman Nidhi (PM-KISAN)',
    schemeState: null,
    status: 'SUBMITTED',
    notes: 'Applied at the Gaya block office on 12 March. Awaiting land record verification.',
  },
  {
    applicantKey: 'ramesh-bihar-farmer',
    schemeName: 'Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (PM-JAY)',
    schemeState: null,
    status: 'IN_PROGRESS',
    notes: 'Ration card details still to be added.',
  },
  {
    applicantKey: 'priya-up-student',
    schemeName: 'Post Matric Scholarship for Scheduled Caste Students',
    schemeState: null,
    status: 'UNDER_REVIEW',
    notes: 'Institution has forwarded the application to the state nodal officer.',
  },
];

/**
 * Deterministic UUID derived from a natural key.
 *
 * Prisma generates IDs client-side, so an upsert needs to know the ID up front.
 * Hashing the natural key means re-running the seed updates the same rows rather
 * than creating duplicates, and applications keep pointing at the right scheme.
 */
function stableUuid(namespace: string, key: string): string {
  const hex = createHash('sha256').update(`${namespace}:${key}`).digest('hex');
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function schemeId(name: string, state: string | null): string {
  return stableUuid('scheme', `${name}|${state ?? 'CENTRAL'}`);
}

async function seedSchemes(): Promise<void> {
  for (const scheme of SCHEMES) {
    // Validate before writing: a malformed rule fails here with a precise Zod
    // error rather than tripping the database CHECK constraint later.
    const eligibility = normalizeEligibility(scheme.eligibility);

    const data = {
      name: scheme.name,
      ministry: scheme.ministry,
      state: scheme.state,
      category: scheme.category,
      benefitText: scheme.benefitText,
      applicationUrl: scheme.applicationUrl,
      eligibility: eligibility as unknown as Prisma.InputJsonObject,
      requiredDocuments: scheme.requiredDocuments,
      sourceUrl: scheme.sourceUrl,
      lastScrapedAt: new Date(),
    };

    await prisma.scheme.upsert({
      where: { id: schemeId(scheme.name, scheme.state) },
      create: { id: schemeId(scheme.name, scheme.state), ...data },
      update: data,
    });
  }
}

async function seedApplicants(): Promise<void> {
  for (const applicant of APPLICANTS) {
    const data = {
      age: applicant.age,
      gender: applicant.gender,
      incomeBracket: applicant.incomeBracket,
      occupation: applicant.occupation,
      state: applicant.state,
      district: applicant.district,
      socialCategory: applicant.socialCategory,
      landHolding:
        applicant.landHolding === null
          ? null
          : new Prisma.Decimal(applicant.landHolding.toFixed(4)),
      isStudent: applicant.isStudent,
      hasDisability: applicant.hasDisability,
    };

    await prisma.applicant.upsert({
      where: { id: stableUuid('applicant', applicant.key) },
      create: { id: stableUuid('applicant', applicant.key), ...data },
      update: data,
    });
  }
}

async function seedApplications(): Promise<void> {
  for (const application of APPLICATIONS) {
    const applicantId = stableUuid('applicant', application.applicantKey);
    const targetSchemeId = schemeId(application.schemeName, application.schemeState);
    const filed = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(
      application.status,
    );

    const data = {
      status: application.status,
      notes: application.notes,
      appliedAt: filed ? new Date() : null,
      lastCheckedAt: new Date(),
    };

    await prisma.application.upsert({
      where: { applicantId_schemeId: { applicantId, schemeId: targetSchemeId } },
      create: { applicantId, schemeId: targetSchemeId, ...data },
      update: data,
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding schemes...');
  await seedSchemes();

  console.log('Seeding applicants...');
  await seedApplicants();

  console.log('Seeding applications...');
  await seedApplications();

  const [schemes, applicants, applications, central] = await Promise.all([
    prisma.scheme.count(),
    prisma.applicant.count(),
    prisma.application.count(),
    prisma.scheme.count({ where: { state: null } }),
  ]);

  console.log(
    `\nDone. ${schemes} schemes (${central} central, ${schemes - central} state-level), ` +
      `${applicants} applicants, ${applications} tracked applications.`,
  );
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
