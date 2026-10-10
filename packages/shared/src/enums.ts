/**
 * Canonical domain enums.
 *
 * These are the single source of truth for every enumerated value in the system.
 * `apps/api/src/prisma/enum-parity.ts` contains type-level assertions that fail
 * `typecheck` if the Prisma enums in `schema.prisma` ever drift from this file.
 */

export const GENDERS = ['MALE', 'FEMALE', 'TRANSGENDER'] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * Reservation / social categories as used on Indian government application forms.
 * EWS is income-based rather than caste-based but appears in the same form field.
 */
export const SOCIAL_CATEGORIES = ['GENERAL', 'EWS', 'OBC', 'SC', 'ST', 'MINORITY'] as const;
export type SocialCategory = (typeof SOCIAL_CATEGORIES)[number];

/**
 * Coarse occupation buckets. Deliberately an enum rather than free text: eligibility
 * matching compares occupation by equality, so uncontrolled strings from a speech
 * transcript ("kisaan", "farmer", "farming") would silently fail to match.
 * Map transcripts onto these values in the voice layer, not in the database.
 */
export const OCCUPATIONS = [
  'FARMER',
  'AGRICULTURAL_LABOURER',
  'DAILY_WAGE_LABOURER',
  'ARTISAN',
  'WEAVER',
  'FISHERMAN',
  'LIVESTOCK_REARER',
  'STREET_VENDOR',
  'SMALL_BUSINESS_OWNER',
  'SELF_EMPLOYED',
  'SALARIED_PRIVATE',
  'GOVERNMENT_EMPLOYEE',
  'STUDENT',
  'HOMEMAKER',
  'UNEMPLOYED',
  'RETIRED',
  'OTHER',
] as const;
export type Occupation = (typeof OCCUPATIONS)[number];

export const INCOME_BRACKETS = [
  'BELOW_50K',
  'INR_50K_TO_1L',
  'INR_1L_TO_2_5L',
  'INR_2_5L_TO_5L',
  'INR_5L_TO_8L',
  'INR_8L_TO_10L',
  'ABOVE_10L',
] as const;
export type IncomeBracket = (typeof INCOME_BRACKETS)[number];

export const SCHEME_CATEGORIES = [
  'AGRICULTURE',
  'EDUCATION',
  'HEALTHCARE',
  'HOUSING',
  'EMPLOYMENT',
  'SKILL_DEVELOPMENT',
  'FINANCIAL_INCLUSION',
  'SOCIAL_SECURITY',
  'WOMEN_AND_CHILD',
  'ENTREPRENEURSHIP',
  'ENERGY',
  'WATER_AND_SANITATION',
  'DISABILITY_WELFARE',
  'SENIOR_CITIZEN',
  'TRANSPORT',
  'OTHER',
] as const;
export type SchemeCategory = (typeof SCHEME_CATEGORIES)[number];

export const APPLICATION_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Human-readable labels, kept next to the values so the UI never hardcodes strings. */
export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  TRANSGENDER: 'Transgender',
};

export const SOCIAL_CATEGORY_LABELS: Record<SocialCategory, string> = {
  GENERAL: 'General',
  EWS: 'EWS (Economically Weaker Section)',
  OBC: 'OBC',
  SC: 'Scheduled Caste',
  ST: 'Scheduled Tribe',
  MINORITY: 'Minority',
};

export const OCCUPATION_LABELS: Record<Occupation, string> = {
  FARMER: 'Farmer',
  AGRICULTURAL_LABOURER: 'Agricultural labourer',
  DAILY_WAGE_LABOURER: 'Daily wage labourer',
  ARTISAN: 'Artisan / craftsperson',
  WEAVER: 'Weaver',
  FISHERMAN: 'Fisherman',
  LIVESTOCK_REARER: 'Livestock rearer',
  STREET_VENDOR: 'Street vendor',
  SMALL_BUSINESS_OWNER: 'Small business owner',
  SELF_EMPLOYED: 'Self-employed',
  SALARIED_PRIVATE: 'Salaried (private sector)',
  GOVERNMENT_EMPLOYEE: 'Government employee',
  STUDENT: 'Student',
  HOMEMAKER: 'Homemaker',
  UNEMPLOYED: 'Unemployed',
  RETIRED: 'Retired',
  OTHER: 'Other',
};

export const SCHEME_CATEGORY_LABELS: Record<SchemeCategory, string> = {
  AGRICULTURE: 'Agriculture & farming',
  EDUCATION: 'Education & scholarships',
  HEALTHCARE: 'Health & insurance',
  HOUSING: 'Housing',
  EMPLOYMENT: 'Employment & wages',
  SKILL_DEVELOPMENT: 'Skill development',
  FINANCIAL_INCLUSION: 'Banking & credit',
  SOCIAL_SECURITY: 'Pension & social security',
  WOMEN_AND_CHILD: 'Women & child welfare',
  ENTREPRENEURSHIP: 'Business & entrepreneurship',
  ENERGY: 'Electricity & cooking fuel',
  WATER_AND_SANITATION: 'Water & sanitation',
  DISABILITY_WELFARE: 'Disability welfare',
  SENIOR_CITIZEN: 'Senior citizens',
  TRANSPORT: 'Transport',
  OTHER: 'Other',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
