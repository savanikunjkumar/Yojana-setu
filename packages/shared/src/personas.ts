import type { ApplicantProfile } from './applicant';

/**
 * Demo personas.
 *
 * Chosen so each produces a visibly different match set from the real scraped data rather
 * than three variations of the same result — a demo where every persona returns the same
 * schemes proves nothing. Between them they exercise the three things worth showing:
 * a scholarship path gated on student status, an occupation and land-ceiling path, and an
 * age-gated path that lands on a PROXY match so the approximate-match distinction has
 * something to demonstrate.
 *
 * `spokenIntro` is what to say into the microphone to reach the same profile by voice, so
 * the typed and spoken paths can be shown to agree.
 */
export interface DemoPersona {
  id: string;
  name: string;
  /** One line a presenter can read out. */
  summary: string;
  profile: ApplicantProfile;
  spokenIntro: string;
  /** What this persona is meant to demonstrate. */
  demonstrates: string;
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: 'student',
    name: 'Priya, 19',
    summary: 'Scheduled Caste student in Uttar Pradesh, family income under ₹50,000',
    demonstrates: 'Scholarships gated on student status and social category',
    profile: {
      age: 19,
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
    spokenIntro:
      'main unnees saal ki hoon, Uttar Pradesh se, college mein padh rahi hoon, anusuchit jaati se hoon aur ghar ki aay pachas hazaar se kam hai',
  },
  {
    id: 'farmer',
    name: 'Ramesh, 41',
    summary: 'Small farmer in Bihar with 1.2 hectares, OBC, income ₹1–2.5 lakh',
    demonstrates: 'Occupation and land-ceiling criteria, plus an income bracket that straddles a cap',
    profile: {
      age: 41,
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
    spokenIntro:
      'main iktalis saal ka kisan hoon, Bihar ke Gaya se, mere paas sava hectare zameen hai aur saal ki kamai do lakh ke aas paas hai',
  },
  {
    id: 'widow',
    name: 'Kamala, 67',
    summary: 'Elderly widow in Madhya Pradesh, no land, income under ₹50,000',
    demonstrates:
      'Age-gated pensions — and a PROXY match (the widow pension), where the income ceiling is our approximation of BPL criteria',
    profile: {
      age: 67,
      gender: 'FEMALE',
      incomeBracket: 'BELOW_50K',
      occupation: 'HOMEMAKER',
      // Madhya Pradesh deliberately: it is where the scraped data holds the Indira Gandhi
      // National Widow Pension Scheme, a PROXY-flagged scheme whose subject matches this
      // persona exactly. Every PROXY scheme in the corpus is state-scoped, so the state has
      // to be chosen to reach one — otherwise the approximate-match distinction has nothing
      // to demonstrate.
      state: 'IN-MP',
      district: 'Rewa',
      socialCategory: 'GENERAL',
      landHolding: 0,
      isStudent: false,
      hasDisability: false,
    },
    spokenIntro:
      'meri umar sadsath saal hai, main vidhwa hoon, Madhya Pradesh mein rehti hoon, koi zameen nahi hai aur aay bahut kam hai',
  },
];

export function findPersona(id: string): DemoPersona | undefined {
  return DEMO_PERSONAS.find((persona) => persona.id === id);
}
