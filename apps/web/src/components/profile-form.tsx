'use client';

import {
  GENDERS,
  GENDER_LABELS,
  INCOME_BRACKETS,
  INCOME_BRACKET_BOUNDS,
  INDIAN_REGIONS,
  OCCUPATIONS,
  OCCUPATION_LABELS,
  SOCIAL_CATEGORIES,
  SOCIAL_CATEGORY_LABELS,
  type ApplicantProfile,
} from '@sih/shared';

/**
 * Every option list here comes from @sih/shared, which is the point of the
 * package: the dropdown a citizen sees cannot drift from the values the matcher
 * compares against in SQL.
 */
export function ProfileForm({
  profile,
  onChange,
}: {
  profile: ApplicantProfile;
  onChange: (patch: Partial<ApplicantProfile>) => void;
}) {
  return (
    <div className="divide-y divide-rule">
      <Row htmlFor="age" label="Age">
        <input
          id="age"
          className="field"
          type="number"
          inputMode="numeric"
          min={0}
          max={120}
          placeholder="Years"
          value={profile.age ?? ''}
          onChange={(event) => onChange({ age: toNumber(event.target.value) })}
        />
      </Row>

      <Row htmlFor="state" label="State">
        <select
          id="state"
          className="field"
          value={profile.state ?? ''}
          onChange={(event) => onChange({ state: toText(event.target.value) })}
        >
          <option value="">Not answered</option>
          {INDIAN_REGIONS.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </select>
      </Row>

      <Row htmlFor="district" label="District">
        <input
          id="district"
          className="field"
          type="text"
          placeholder="Optional"
          value={profile.district ?? ''}
          onChange={(event) => onChange({ district: toText(event.target.value) })}
        />
      </Row>

      <Row htmlFor="incomeBracket" label="Yearly family income">
        <select
          id="incomeBracket"
          className="field"
          value={profile.incomeBracket ?? ''}
          onChange={(event) =>
            onChange({ incomeBracket: toEnum(event.target.value, INCOME_BRACKETS) })
          }
        >
          <option value="">Not answered</option>
          {INCOME_BRACKETS.map((bracket) => (
            <option key={bracket} value={bracket}>
              {INCOME_BRACKET_BOUNDS[bracket].label}
            </option>
          ))}
        </select>
      </Row>

      <Row htmlFor="occupation" label="Work">
        <select
          id="occupation"
          className="field"
          value={profile.occupation ?? ''}
          onChange={(event) => onChange({ occupation: toEnum(event.target.value, OCCUPATIONS) })}
        >
          <option value="">Not answered</option>
          {OCCUPATIONS.map((occupation) => (
            <option key={occupation} value={occupation}>
              {OCCUPATION_LABELS[occupation]}
            </option>
          ))}
        </select>
      </Row>

      <Row htmlFor="socialCategory" label="Category">
        <select
          id="socialCategory"
          className="field"
          value={profile.socialCategory ?? ''}
          onChange={(event) =>
            onChange({ socialCategory: toEnum(event.target.value, SOCIAL_CATEGORIES) })
          }
        >
          <option value="">Not answered</option>
          {SOCIAL_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {SOCIAL_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </Row>

      <Row htmlFor="gender" label="Gender">
        <select
          id="gender"
          className="field"
          value={profile.gender ?? ''}
          onChange={(event) => onChange({ gender: toEnum(event.target.value, GENDERS) })}
        >
          <option value="">Not answered</option>
          {GENDERS.map((gender) => (
            <option key={gender} value={gender}>
              {GENDER_LABELS[gender]}
            </option>
          ))}
        </select>
      </Row>

      <Row htmlFor="landHolding" label="Farm land (hectares)">
        <input
          id="landHolding"
          className="field"
          type="number"
          inputMode="decimal"
          min={0}
          step={0.1}
          placeholder="0 if none"
          value={profile.landHolding ?? ''}
          onChange={(event) => onChange({ landHolding: toNumber(event.target.value) })}
        />
      </Row>

      <Row htmlFor="isStudent" label="Currently studying">
        <TriStateSelect
          id="isStudent"
          value={profile.isStudent}
          onChange={(value) => onChange({ isStudent: value })}
        />
      </Row>

      <Row htmlFor="hasDisability" label="Disability certificate">
        <TriStateSelect
          id="hasDisability"
          value={profile.hasDisability}
          onChange={(value) => onChange({ hasDisability: value })}
        />
      </Row>
    </div>
  );
}

function Row({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-baseline gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <label className="label-caps pt-2" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * "Not answered" is a distinct state from "no", because the matcher treats an
 * unanswered criterion as UNKNOWN rather than as a rejection.
 */
function TriStateSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <select
      id={id}
      className="field"
      value={value === null ? '' : String(value)}
      onChange={(event) =>
        onChange(event.target.value === '' ? null : event.target.value === 'true')
      }
    >
      <option value="">Not answered</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}

function toNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: string): string | null {
  return value.trim() === '' ? null : value;
}

function toEnum<T extends string>(value: string, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}
