import type { $Enums } from '@prisma/client';
import type {
  ApplicationStatus,
  Gender,
  IncomeBracket,
  Occupation,
  SchemeCategory,
  SocialCategory,
} from '@sih/shared';

/**
 * Prisma generates its own enum types from schema.prisma, while the rest of the
 * codebase imports them from @sih/shared. Nothing links the two at runtime, so
 * these assertions link them at compile time: if an enum member is added,
 * renamed or removed on one side only, `npm run typecheck` fails here with a
 * "Type 'true' is not assignable to type 'never'" error pointing at the culprit.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const ENUM_PARITY = {
  gender: true as Exact<$Enums.Gender, Gender>,
  socialCategory: true as Exact<$Enums.SocialCategory, SocialCategory>,
  occupation: true as Exact<$Enums.Occupation, Occupation>,
  incomeBracket: true as Exact<$Enums.IncomeBracket, IncomeBracket>,
  schemeCategory: true as Exact<$Enums.SchemeCategory, SchemeCategory>,
  applicationStatus: true as Exact<$Enums.ApplicationStatus, ApplicationStatus>,
} as const;
