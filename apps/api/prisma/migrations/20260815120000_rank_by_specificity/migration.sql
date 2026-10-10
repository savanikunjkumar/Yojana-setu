-- Ranks matches by how much of the scheme's rule we could actually confirm, and returns that
-- count so every caller ranks on one definition instead of reimplementing it.
--
-- Ordering was `failed, unverified, name`. Schemes whose prose yielded no extractable rule score
-- zero on both counts, so they tied with genuinely well-matched schemes and fell back to
-- alphabetical order — putting the same few criteria-less schemes at the top of every result set
-- regardless of who was asking.
--
-- RETURNS TABLE gains a column, so the function is dropped and recreated rather than replaced.

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
  "proxyNote" text,
  "checks" jsonb,
  "failedCriteria" text[],
  "unverifiedCriteria" text[],
  "confirmedCount" integer,
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
      s.proxy_note,
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
      ]::text[], NULL) AS unverified,
      -- How many criteria this scheme actually STATES and this profile satisfies.
      --
      -- The distinction from a plain PASS count matters, and getting it wrong inverts the
      -- ranking. `elig_*` return PASS when the scheme states no rule — an absent bound cannot
      -- exclude anybody — so a scheme whose prose yielded nothing scores PASS ten times over
      -- and looks like the strongest match in the corpus. Each term below therefore requires a
      -- rule to be present (a non-null bound, a non-wildcard set, a flag that is actually set)
      -- before its PASS is counted as evidence.
      (
        ((v.eligibility ->> 'minAge') IS NOT NULL              AND v.v_min_age         = 'PASS')::int +
        ((v.eligibility ->> 'maxAge') IS NOT NULL              AND v.v_max_age         = 'PASS')::int +
        ((v.eligibility ->> 'maxAnnualIncome') IS NOT NULL     AND v.v_income          = 'PASS')::int +
        ((v.eligibility ->> 'gender') <> '*'                   AND v.v_gender          = 'PASS')::int +
        (NOT (v.eligibility -> 'socialCategory' ? '*')         AND v.v_social_category = 'PASS')::int +
        (NOT (v.eligibility -> 'occupation' ? '*')             AND v.v_occupation      = 'PASS')::int +
        (NOT (v.eligibility -> 'states' ? '*')                 AND v.v_states          = 'PASS')::int +
        ((v.eligibility ->> 'maxLandHolding') IS NOT NULL      AND v.v_max_land        = 'PASS')::int +
        ((v.eligibility ->> 'requiresDisability')::boolean     AND v.v_disability      = 'PASS')::int +
        ((v.eligibility ->> 'isStudentOnly')::boolean          AND v.v_student         = 'PASS')::int
      )                AS confirmed
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
    sc.proxy_note::text,
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
    sc.confirmed                                      AS confirmed_count,
    cardinality(sc.failed) = 0                        AS is_eligible,
    sc.v_income = 'UNKNOWN'                           AS needs_income_verification,
    GREATEST(
      0,
      100 - (30 * cardinality(sc.failed)) - (8 * cardinality(sc.unverified))
    )::integer                                        AS match_score
  FROM scored sc
  WHERE cardinality(sc.failed) <= p_max_failures
  ORDER BY
    cardinality(sc.failed),
    -- Specificity, and the reason this migration exists.
    --
    -- A scheme whose eligibility prose yielded no machine-readable rule cannot fail anybody and
    -- has nothing left unverified, so it tied for first place and then won on alphabetical
    -- order. The visible effect was a research fellowship heading the results for a 67-year-old
    -- widow and a small farmer alike — both a bad look and bad advice.
    --
    -- Ranking by stated-and-satisfied criteria puts the schemes we can actually justify first:
    -- an old-age pension that matched on age, gender, income and state outranks one that matched
    -- by saying nothing. The silent schemes are still returned — they may well be genuine, and
    -- dropping them would be exactly the wrongful-exclusion error this system exists to avoid —
    -- they simply stop crowding out better-evidenced results.
    sc.confirmed DESC,
    cardinality(sc.unverified),
    sc.name;
$$;
