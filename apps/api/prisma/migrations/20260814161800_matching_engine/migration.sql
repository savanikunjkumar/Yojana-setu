-- ===========================================================================
-- Matching engine
-- ===========================================================================
--
-- Eligibility matching happens entirely inside Postgres, in one statement:
--
--   SELECT * FROM match_schemes('{"age":34,"state":"IN-BR",...}'::jsonb, 0, NULL);
--
-- Why in the database rather than in the API:
--   * One round trip regardless of how many schemes exist — no N+1 over rules.
--   * The rules are the same for every caller (API, batch re-check cron, admin
--     tooling, a psql session during a demo), so they live in one place.
--   * Postgres evaluates the whole conjunction per row without materializing
--     every scheme into JS objects first.
--
-- Every criterion resolves to one of three values rather than a boolean:
--
--   PASS    — the applicant satisfies it
--   FAIL    — the applicant definitively does not
--   UNKNOWN — the profile has no answer yet, or the applicant's income bracket
--             straddles the scheme's income cap
--
-- UNKNOWN is what makes a voice-first flow possible: a half-finished profile
-- must not read as a rejection, and the API uses the UNKNOWN set to decide which
-- question to ask next.
--
-- Prisma does not manage functions, CHECK constraints or comments, so nothing
-- here is at risk of being dropped by a future `prisma migrate dev`. It is also
-- written to be idempotent, so it can be re-applied by hand at any time.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shape guard for schemes.eligibility
--
-- The matcher relies on categorical criteria always being present, and on the
-- '*' wildcard standing in for "excludes nobody" (see packages/shared/src/
-- eligibility.ts). That invariant is what removes the NULL branches from the
-- predicates below, so the database enforces it rather than trusting callers:
-- a scraper writing raw JSON gets an error instead of quietly publishing a rule
-- that matches the wrong people.
--
-- Comparisons are written so no branch can raise on unexpected input:
-- jsonb_typeof() returns NULL for a missing key, and `<> '[]'::jsonb` never
-- errors regardless of the value's type. `IS TRUE` collapses those NULLs to
-- false, since a CHECK constraint only rejects an outright FALSE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.schemes DROP CONSTRAINT IF EXISTS schemes_eligibility_normalized;
ALTER TABLE public.schemes
  ADD CONSTRAINT schemes_eligibility_normalized CHECK (
    jsonb_typeof(eligibility) = 'object'
    -- Categorical criteria: present, correctly typed, never empty.
    AND (jsonb_typeof(eligibility -> 'gender') = 'string') IS TRUE
    AND (jsonb_typeof(eligibility -> 'socialCategory') = 'array') IS TRUE
    AND (jsonb_typeof(eligibility -> 'occupation') = 'array') IS TRUE
    AND (jsonb_typeof(eligibility -> 'states') = 'array') IS TRUE
    AND eligibility -> 'socialCategory' <> '[]'::jsonb
    AND eligibility -> 'occupation' <> '[]'::jsonb
    AND eligibility -> 'states' <> '[]'::jsonb
    -- Numeric bounds: a number, or JSON null meaning "unbounded".
    AND jsonb_typeof(eligibility -> 'minAge') IN ('number', 'null')
    AND jsonb_typeof(eligibility -> 'maxAge') IN ('number', 'null')
    AND jsonb_typeof(eligibility -> 'maxAnnualIncome') IN ('number', 'null')
    AND jsonb_typeof(eligibility -> 'maxLandHolding') IN ('number', 'null')
    -- Flags: real booleans, so ::boolean casts below cannot fail.
    AND (jsonb_typeof(eligibility -> 'requiresDisability') = 'boolean') IS TRUE
    AND (jsonb_typeof(eligibility -> 'isStudentOnly') = 'boolean') IS TRUE
  );

COMMENT ON CONSTRAINT schemes_eligibility_normalized ON public.schemes IS
  'Enforces the normalized EligibilityRule shape from @sih/shared. Always write this column via normalizeEligibility().';

-- ---------------------------------------------------------------------------
-- Criterion primitives
--
-- Deliberately LANGUAGE sql (not plpgsql) and IMMUTABLE: single-expression SQL
-- functions get inlined by the planner, so a 10-criterion evaluation costs
-- roughly what the equivalent inline CASE would, with none of the duplication.
-- They are intentionally not STRICT — NULL is meaningful input here ("not
-- answered yet"), and a STRICT function would short-circuit to NULL instead of
-- returning UNKNOWN, as well as blocking inlining.
-- ---------------------------------------------------------------------------

-- Applicant value must be at least the scheme's lower bound (e.g. minAge).
CREATE OR REPLACE FUNCTION public.elig_at_least(applicant_value numeric, lower_bound numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN lower_bound IS NULL THEN 'PASS'
    WHEN applicant_value IS NULL THEN 'UNKNOWN'
    WHEN applicant_value >= lower_bound THEN 'PASS'
    ELSE 'FAIL'
  END;
$$;

-- Applicant value must not exceed the scheme's upper bound (maxAge, maxLandHolding).
CREATE OR REPLACE FUNCTION public.elig_at_most(applicant_value numeric, upper_bound numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN upper_bound IS NULL THEN 'PASS'
    WHEN applicant_value IS NULL THEN 'UNKNOWN'
    WHEN applicant_value <= upper_bound THEN 'PASS'
    ELSE 'FAIL'
  END;
$$;

-- Applicant value must appear in the scheme's allowed set, where the set may be
-- the wildcard ['*']. One containment test covers both "allowed" and
-- "unrestricted", which is why the wildcard is materialized at write time.
CREATE OR REPLACE FUNCTION public.elig_in_set(applicant_value text, allowed jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN allowed IS NULL OR allowed ? '*' THEN 'PASS'
    WHEN applicant_value IS NULL THEN 'UNKNOWN'
    WHEN allowed ? applicant_value THEN 'PASS'
    ELSE 'FAIL'
  END;
$$;

-- Single-valued categorical criterion (gender), '*' meaning any.
CREATE OR REPLACE FUNCTION public.elig_equals(applicant_value text, allowed text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN allowed IS NULL OR allowed = '*' THEN 'PASS'
    WHEN applicant_value IS NULL THEN 'UNKNOWN'
    WHEN applicant_value = allowed THEN 'PASS'
    ELSE 'FAIL'
  END;
$$;

-- Scheme demands a boolean attribute (requiresDisability, isStudentOnly).
-- A scheme that does not demand it never excludes anyone on that basis.
CREATE OR REPLACE FUNCTION public.elig_requires_flag(applicant_value boolean, is_required boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN is_required IS NOT TRUE THEN 'PASS'
    WHEN applicant_value IS NULL THEN 'UNKNOWN'
    WHEN applicant_value THEN 'PASS'
    ELSE 'FAIL'
  END;
$$;

-- Income is reported as a bracket, so the applicant has a range while the scheme
-- has a single cap. A bracket entirely under the cap passes, one entirely above
-- it fails, and one straddling it is UNKNOWN — the API then asks for an exact
-- figure instead of guessing in either direction.
CREATE OR REPLACE FUNCTION public.elig_income_within(
  income_lower numeric,
  income_upper numeric,
  income_cap numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN income_cap IS NULL THEN 'PASS'
    WHEN income_lower IS NULL THEN 'UNKNOWN'
    WHEN income_upper IS NOT NULL AND income_upper <= income_cap THEN 'PASS'
    WHEN income_lower > income_cap THEN 'FAIL'
    ELSE 'UNKNOWN'
  END;
$$;

-- ---------------------------------------------------------------------------
-- match_schemes(applicant, max_failures, category)
--
--   p_applicant     JSONB built by `toMatchInput()` in @sih/shared.
--   p_max_failures  0 returns only schemes the applicant actually qualifies for.
--                   1–2 also returns near misses, so the UI can explain what
--                   stands between the citizen and the benefit.
--   p_category      Optional SchemeCategory filter, applied before evaluation.
--
-- Output columns are quoted camelCase so `prisma.$queryRaw` hydrates the shared
-- `MatchedScheme` type with no field remapping.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.match_schemes(jsonb, integer, text);
CREATE FUNCTION public.match_schemes(
  p_applicant jsonb,
  p_max_failures integer DEFAULT 0,
  p_category text DEFAULT NULL
)
RETURNS TABLE (
  "id" uuid,
  "name" text,
  "ministry" text,
  "state" text,
  "category" text,
  "benefitText" text,
  "applicationUrl" text,
  "eligibility" jsonb,
  "requiredDocuments" text[],
  "sourceUrl" text,
  "lastScrapedAt" timestamptz,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "checks" jsonb,
  "failedCriteria" text[],
  "unverifiedCriteria" text[],
  "isEligible" boolean,
  "needsIncomeVerification" boolean,
  "matchScore" integer
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH applicant AS (
    SELECT
      (p_applicant ->> 'age')::numeric               AS age,
      p_applicant ->> 'gender'                       AS gender,
      (p_applicant ->> 'annualIncomeLower')::numeric AS income_lower,
      (p_applicant ->> 'annualIncomeUpper')::numeric AS income_upper,
      p_applicant ->> 'occupation'                   AS occupation,
      p_applicant ->> 'socialCategory'               AS social_category,
      p_applicant ->> 'state'                        AS state,
      (p_applicant ->> 'landHolding')::numeric       AS land_holding,
      (p_applicant ->> 'isStudent')::boolean         AS is_student,
      (p_applicant ->> 'hasDisability')::boolean     AS has_disability
  ),
  -- Each criterion is evaluated exactly once, into a scalar. Everything below
  -- reads these columns instead of re-deriving anything, so the ten primitive
  -- calls per scheme are the entire per-row cost.
  verdicts AS (
    SELECT
      s.id,
      s.name,
      s.ministry,
      s.state,
      s.category,
      s.benefit_text,
      s.application_url,
      s.eligibility,
      s.required_documents,
      s.source_url,
      s.last_scraped_at,
      s.created_at,
      s.updated_at,
      public.elig_at_least(a.age, (s.eligibility ->> 'minAge')::numeric) AS v_min_age,
      public.elig_at_most(a.age, (s.eligibility ->> 'maxAge')::numeric) AS v_max_age,
      public.elig_income_within(
        a.income_lower,
        a.income_upper,
        (s.eligibility ->> 'maxAnnualIncome')::numeric
      ) AS v_income,
      public.elig_equals(a.gender, s.eligibility ->> 'gender') AS v_gender,
      public.elig_in_set(a.social_category, s.eligibility -> 'socialCategory') AS v_social_category,
      public.elig_in_set(a.occupation, s.eligibility -> 'occupation') AS v_occupation,
      public.elig_in_set(a.state, s.eligibility -> 'states') AS v_states,
      public.elig_at_most(a.land_holding, (s.eligibility ->> 'maxLandHolding')::numeric) AS v_max_land,
      public.elig_requires_flag(
        a.has_disability,
        (s.eligibility ->> 'requiresDisability')::boolean
      ) AS v_disability,
      public.elig_requires_flag(
        a.is_student,
        (s.eligibility ->> 'isStudentOnly')::boolean
      ) AS v_student
    FROM public.schemes s
    CROSS JOIN applicant a
    WHERE p_category IS NULL OR s.category::text = p_category
  ),
  -- Verdicts collapse into two arrays via plain CASE expressions. Building them
  -- positionally rather than aggregating over the checks map avoids a per-row
  -- sort, and fixes a useful order: criteria come out in the sequence a person
  -- would naturally be asked about them, matching ELIGIBILITY_CRITERIA in
  -- @sih/shared. Adding a criterion means touching all three lists below.
  scored AS (
    SELECT
      v.*,
      array_remove(ARRAY[
        CASE WHEN v.v_min_age         = 'FAIL' THEN 'minAge' END,
        CASE WHEN v.v_max_age         = 'FAIL' THEN 'maxAge' END,
        CASE WHEN v.v_income          = 'FAIL' THEN 'maxAnnualIncome' END,
        CASE WHEN v.v_gender          = 'FAIL' THEN 'gender' END,
        CASE WHEN v.v_social_category = 'FAIL' THEN 'socialCategory' END,
        CASE WHEN v.v_occupation      = 'FAIL' THEN 'occupation' END,
        CASE WHEN v.v_states          = 'FAIL' THEN 'states' END,
        CASE WHEN v.v_max_land        = 'FAIL' THEN 'maxLandHolding' END,
        CASE WHEN v.v_disability      = 'FAIL' THEN 'requiresDisability' END,
        CASE WHEN v.v_student         = 'FAIL' THEN 'isStudentOnly' END
      ]::text[], NULL) AS failed,
      array_remove(ARRAY[
        CASE WHEN v.v_min_age         = 'UNKNOWN' THEN 'minAge' END,
        CASE WHEN v.v_max_age         = 'UNKNOWN' THEN 'maxAge' END,
        CASE WHEN v.v_income          = 'UNKNOWN' THEN 'maxAnnualIncome' END,
        CASE WHEN v.v_gender          = 'UNKNOWN' THEN 'gender' END,
        CASE WHEN v.v_social_category = 'UNKNOWN' THEN 'socialCategory' END,
        CASE WHEN v.v_occupation      = 'UNKNOWN' THEN 'occupation' END,
        CASE WHEN v.v_states          = 'UNKNOWN' THEN 'states' END,
        CASE WHEN v.v_max_land        = 'UNKNOWN' THEN 'maxLandHolding' END,
        CASE WHEN v.v_disability      = 'UNKNOWN' THEN 'requiresDisability' END,
        CASE WHEN v.v_student         = 'UNKNOWN' THEN 'isStudentOnly' END
      ]::text[], NULL) AS unverified
    FROM verdicts v
  )
  -- The checks map is assembled last, so it is only built for rows that survive
  -- the p_max_failures filter rather than for every scheme in the table.
  SELECT
    sc.id,
    sc.name::text,
    sc.ministry::text,
    sc.state::text,
    sc.category::text,
    sc.benefit_text::text,
    sc.application_url::text,
    sc.eligibility,
    sc.required_documents,
    sc.source_url::text,
    sc.last_scraped_at,
    sc.created_at,
    sc.updated_at,
    -- Keys match EligibilityCriterion in @sih/shared exactly; the UI renders
    -- this map directly as the "why" behind every result.
    jsonb_build_object(
      'minAge', sc.v_min_age,
      'maxAge', sc.v_max_age,
      'maxAnnualIncome', sc.v_income,
      'gender', sc.v_gender,
      'socialCategory', sc.v_social_category,
      'occupation', sc.v_occupation,
      'states', sc.v_states,
      'maxLandHolding', sc.v_max_land,
      'requiresDisability', sc.v_disability,
      'isStudentOnly', sc.v_student
    )                                                 AS checks,
    sc.failed,
    sc.unverified,
    cardinality(sc.failed) = 0                        AS is_eligible,
    sc.v_income = 'UNKNOWN'                           AS needs_income_verification,
    GREATEST(
      0,
      100 - (30 * cardinality(sc.failed)) - (8 * cardinality(sc.unverified))
    )::integer                                        AS match_score
  FROM scored sc
  WHERE cardinality(sc.failed) <= p_max_failures
  ORDER BY cardinality(sc.failed), cardinality(sc.unverified), sc.name;
$$;

COMMENT ON FUNCTION public.match_schemes(jsonb, integer, text) IS
  'Single-query eligibility matcher. Pass the JSONB produced by toMatchInput() in @sih/shared. Returns every scheme with at most p_max_failures failed criteria, along with a per-criterion PASS/FAIL/UNKNOWN breakdown.';
