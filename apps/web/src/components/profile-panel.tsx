'use client';

import clsx from 'clsx';
import {
  GENDER_LABELS,
  INCOME_BRACKET_BOUNDS,
  OCCUPATION_LABELS,
  PROFILE_FIELDS,
  SOCIAL_CATEGORY_LABELS,
  regionName,
  type ApplicantProfile,
} from '@sih/shared';

const FIELD_LABELS: Record<(typeof PROFILE_FIELDS)[number], string> = {
  age: 'Age',
  state: 'State',
  incomeBracket: 'Yearly income',
  occupation: 'Work',
  socialCategory: 'Category',
  gender: 'Gender',
  landHolding: 'Farm land',
  isStudent: 'Studying',
  hasDisability: 'Disability',
};

/**
 * The profile as it fills up.
 *
 * Unanswered fields are left visibly blank rather than hidden or defaulted, because
 * the blank is the point: a blank field is an UNKNOWN criterion, and UNKNOWN keeps a
 * scheme in the running instead of ruling it out. Watching the blanks disappear one
 * question at a time is what makes the distinction legible to someone observing.
 */
export function ProfilePanel({
  profile,
  highlight = [],
}: {
  profile: ApplicantProfile;
  /** Fields the most recent utterance filled, briefly emphasised. */
  highlight?: Array<keyof ApplicantProfile>;
}) {
  const answered = PROFILE_FIELDS.filter((field) => profile[field] !== null).length;

  return (
    <section aria-labelledby="profile-heading" className="sheet p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="profile-heading" className="font-display text-base font-bold text-ink">
          What we know about you
        </h2>
        <p className="label-caps">
          {answered}/{PROFILE_FIELDS.length}
        </p>
      </div>

      <dl className="mt-3 divide-y divide-rule">
        {PROFILE_FIELDS.map((field) => {
          const display = formatField(field, profile);
          const isNew = highlight.includes(field);

          return (
            <div key={field} className="grid grid-cols-[8.5rem_1fr] items-baseline gap-3 py-2">
              <dt className="label-caps">{FIELD_LABELS[field]}</dt>
              <dd
                className={clsx(
                  'font-sans text-sm',
                  display === null && 'text-ink-faint',
                  display !== null && !isNew && 'font-medium text-ink',
                  isNew && 'animate-rise-in bg-teal/10 px-1.5 font-semibold text-teal',
                )}
              >
                {display ?? <span aria-label="not answered yet">—</span>}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-3 border-t border-rule pt-3 font-sans text-xs leading-relaxed text-ink-faint">
        A dash means you haven&apos;t said yet — not &ldquo;no&rdquo;. Those criteria come back as{' '}
        <span className="font-mono text-amber">UNKNOWN</span>, so the scheme stays in the running
        until you answer.
      </p>
    </section>
  );
}

function formatField(
  field: (typeof PROFILE_FIELDS)[number],
  profile: ApplicantProfile,
): string | null {
  switch (field) {
    case 'age':
      return profile.age === null ? null : `${profile.age} years`;
    case 'state':
      return profile.state === null ? null : regionName(profile.state);
    case 'incomeBracket':
      return profile.incomeBracket === null
        ? null
        : INCOME_BRACKET_BOUNDS[profile.incomeBracket].label;
    case 'occupation':
      return profile.occupation === null ? null : OCCUPATION_LABELS[profile.occupation];
    case 'socialCategory':
      return profile.socialCategory === null
        ? null
        : SOCIAL_CATEGORY_LABELS[profile.socialCategory];
    case 'gender':
      return profile.gender === null ? null : GENDER_LABELS[profile.gender];
    case 'landHolding':
      return profile.landHolding === null ? null : `${profile.landHolding} hectares`;
    case 'isStudent':
      return profile.isStudent === null ? null : profile.isStudent ? 'Yes' : 'No';
    case 'hasDisability':
      return profile.hasDisability === null ? null : profile.hasDisability ? 'Yes' : 'No';
    default:
      return null;
  }
}
