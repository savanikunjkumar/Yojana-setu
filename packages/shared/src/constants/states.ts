/**
 * States and union territories keyed by ISO 3166-2:IN code.
 *
 * The code is what gets stored in `applicants.state` and inside a scheme's
 * `eligibility.states[]`, so matching never depends on spelling. `aliases`
 * exists because speech recognition returns older or colloquial names
 * ("Orissa", "Pondicherry") that must be resolved before they reach the DB.
 */
export interface IndianRegion {
  readonly code: string;
  readonly name: string;
  readonly nameHi: string;
  readonly type: 'STATE' | 'UNION_TERRITORY';
  readonly aliases?: readonly string[];
}

export const INDIAN_REGIONS: readonly IndianRegion[] = [
  { code: 'IN-AP', name: 'Andhra Pradesh', nameHi: 'आंध्र प्रदेश', type: 'STATE' },
  { code: 'IN-AR', name: 'Arunachal Pradesh', nameHi: 'अरुणाचल प्रदेश', type: 'STATE' },
  { code: 'IN-AS', name: 'Assam', nameHi: 'असम', type: 'STATE' },
  { code: 'IN-BR', name: 'Bihar', nameHi: 'बिहार', type: 'STATE' },
  { code: 'IN-CT', name: 'Chhattisgarh', nameHi: 'छत्तीसगढ़', type: 'STATE' },
  { code: 'IN-GA', name: 'Goa', nameHi: 'गोवा', type: 'STATE' },
  { code: 'IN-GJ', name: 'Gujarat', nameHi: 'गुजरात', type: 'STATE' },
  { code: 'IN-HR', name: 'Haryana', nameHi: 'हरियाणा', type: 'STATE' },
  { code: 'IN-HP', name: 'Himachal Pradesh', nameHi: 'हिमाचल प्रदेश', type: 'STATE' },
  { code: 'IN-JH', name: 'Jharkhand', nameHi: 'झारखंड', type: 'STATE' },
  { code: 'IN-KA', name: 'Karnataka', nameHi: 'कर्नाटक', type: 'STATE' },
  { code: 'IN-KL', name: 'Kerala', nameHi: 'केरल', type: 'STATE' },
  { code: 'IN-MP', name: 'Madhya Pradesh', nameHi: 'मध्य प्रदेश', type: 'STATE' },
  { code: 'IN-MH', name: 'Maharashtra', nameHi: 'महाराष्ट्र', type: 'STATE' },
  { code: 'IN-MN', name: 'Manipur', nameHi: 'मणिपुर', type: 'STATE' },
  { code: 'IN-ML', name: 'Meghalaya', nameHi: 'मेघालय', type: 'STATE' },
  { code: 'IN-MZ', name: 'Mizoram', nameHi: 'मिजोरम', type: 'STATE' },
  { code: 'IN-NL', name: 'Nagaland', nameHi: 'नागालैंड', type: 'STATE' },
  { code: 'IN-OR', name: 'Odisha', nameHi: 'ओडिशा', type: 'STATE', aliases: ['Orissa'] },
  { code: 'IN-PB', name: 'Punjab', nameHi: 'पंजाब', type: 'STATE' },
  { code: 'IN-RJ', name: 'Rajasthan', nameHi: 'राजस्थान', type: 'STATE' },
  { code: 'IN-SK', name: 'Sikkim', nameHi: 'सिक्किम', type: 'STATE' },
  { code: 'IN-TN', name: 'Tamil Nadu', nameHi: 'तमिलनाडु', type: 'STATE' },
  { code: 'IN-TG', name: 'Telangana', nameHi: 'तेलंगाना', type: 'STATE' },
  { code: 'IN-TR', name: 'Tripura', nameHi: 'त्रिपुरा', type: 'STATE' },
  { code: 'IN-UP', name: 'Uttar Pradesh', nameHi: 'उत्तर प्रदेश', type: 'STATE' },
  {
    code: 'IN-UT',
    name: 'Uttarakhand',
    nameHi: 'उत्तराखंड',
    type: 'STATE',
    aliases: ['Uttaranchal'],
  },
  { code: 'IN-WB', name: 'West Bengal', nameHi: 'पश्चिम बंगाल', type: 'STATE' },
  {
    code: 'IN-AN',
    name: 'Andaman and Nicobar Islands',
    nameHi: 'अंडमान और निकोबार द्वीपसमूह',
    type: 'UNION_TERRITORY',
    aliases: ['Andaman', 'Nicobar'],
  },
  { code: 'IN-CH', name: 'Chandigarh', nameHi: 'चंडीगढ़', type: 'UNION_TERRITORY' },
  {
    code: 'IN-DH',
    name: 'Dadra and Nagar Haveli and Daman and Diu',
    nameHi: 'दादरा और नगर हवेली तथा दमन और दीव',
    type: 'UNION_TERRITORY',
    aliases: ['Dadra and Nagar Haveli', 'Daman and Diu'],
  },
  {
    code: 'IN-DL',
    name: 'Delhi',
    nameHi: 'दिल्ली',
    type: 'UNION_TERRITORY',
    aliases: ['New Delhi', 'NCT of Delhi'],
  },
  {
    code: 'IN-JK',
    name: 'Jammu and Kashmir',
    nameHi: 'जम्मू और कश्मीर',
    type: 'UNION_TERRITORY',
    aliases: ['J&K'],
  },
  { code: 'IN-LA', name: 'Ladakh', nameHi: 'लद्दाख', type: 'UNION_TERRITORY' },
  { code: 'IN-LD', name: 'Lakshadweep', nameHi: 'लक्षद्वीप', type: 'UNION_TERRITORY' },
  {
    code: 'IN-PY',
    name: 'Puducherry',
    nameHi: 'पुदुचेरी',
    type: 'UNION_TERRITORY',
    aliases: ['Pondicherry'],
  },
];

export const REGION_CODES = INDIAN_REGIONS.map((region) => region.code);

const REGION_BY_CODE = new Map(INDIAN_REGIONS.map((region) => [region.code, region]));

export function getRegion(code: string): IndianRegion | undefined {
  return REGION_BY_CODE.get(code.toUpperCase());
}

export function isRegionCode(code: string): boolean {
  return REGION_BY_CODE.has(code.toUpperCase());
}

export function regionName(code: string | null | undefined): string {
  if (!code) return 'All of India';
  return getRegion(code)?.name ?? code;
}

const LOOKUP_INDEX = new Map<string, string>();
for (const region of INDIAN_REGIONS) {
  for (const key of [region.code, region.name, region.nameHi, ...(region.aliases ?? [])]) {
    LOOKUP_INDEX.set(normalizeKey(key), region.code);
  }
}

/**
 * Resolves a spoken or typed region name to its ISO code.
 * Returns `undefined` rather than guessing, so the voice layer can re-prompt
 * instead of silently matching against the wrong state.
 */
export function resolveRegionCode(input: string): string | undefined {
  return LOOKUP_INDEX.get(normalizeKey(input));
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z\u0900-\u097F]/g, '');
}
