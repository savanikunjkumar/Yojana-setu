-- ===========================================================================
-- Assertion suite for match_schemes().
--
--   npm run db:verify        (from the repo root)
--
-- Runs inside a transaction that is rolled back, and every count is scoped to
-- the `T_*` fixtures, so it is safe to run against a seeded database. A failed
-- expectation aborts with an error; a clean run prints only `ok` notices.
-- Add a case here whenever you change a criterion primitive.
-- ===========================================================================

BEGIN;

-- Normalized rule with everything unrestricted; `overrides` replaces top-level
-- keys, mirroring what normalizeEligibility() produces in @sih/shared.
CREATE FUNCTION pg_temp.rule(overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "minAge": null,
    "maxAge": null,
    "maxAnnualIncome": null,
    "gender": "*",
    "socialCategory": ["*"],
    "occupation": ["*"],
    "states": ["*"],
    "maxLandHolding": null,
    "requiresDisability": false,
    "isStudentOnly": false
  }'::jsonb || overrides;
$$;

CREATE FUNCTION pg_temp.add_scheme(p_name text, p_eligibility jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.schemes (
    id, name, ministry, state, category, benefit_text,
    application_url, eligibility, required_documents, source_url, updated_at
  ) VALUES (
    gen_random_uuid(), p_name, 'Test Ministry', NULL, 'OTHER', 'Test benefit',
    'https://example.gov.in/apply', p_eligibility, ARRAY['Aadhaar'],
    'https://example.gov.in', now()
  );
$$;

-- Verdict for one criterion of one scheme. max_failures is wide open so that
-- schemes the applicant fails are still returned and inspectable.
CREATE FUNCTION pg_temp.verdict(p_applicant jsonb, p_scheme text, p_criterion text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT m."checks" ->> p_criterion
  FROM public.match_schemes(p_applicant, 10) m
  WHERE m."name" = p_scheme;
$$;

CREATE FUNCTION pg_temp.match_count(
  p_applicant jsonb,
  p_max_failures integer,
  p_category text DEFAULT NULL
)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT count(*)::text
  FROM public.match_schemes(p_applicant, p_max_failures, p_category) m
  WHERE m."name" ~ '^T_';
$$;

CREATE FUNCTION pg_temp.fixture_count() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT count(*)::text FROM public.schemes WHERE name ~ '^T_';
$$;

CREATE FUNCTION pg_temp.expect(p_label text, p_actual text, p_expected text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL: % — expected %, got %', p_label, p_expected, COALESCE(p_actual, '<null>');
  END IF;
  RAISE NOTICE 'ok   %', p_label;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures — 12 schemes, each isolating one criterion
-- ---------------------------------------------------------------------------
SELECT pg_temp.add_scheme('T_OPEN', pg_temp.rule());
SELECT pg_temp.add_scheme('T_AGE_18_40', pg_temp.rule('{"minAge":18,"maxAge":40}'));
SELECT pg_temp.add_scheme('T_INCOME_2_5L', pg_temp.rule('{"maxAnnualIncome":250000}'));
SELECT pg_temp.add_scheme('T_INCOME_2L', pg_temp.rule('{"maxAnnualIncome":200000}'));
SELECT pg_temp.add_scheme('T_INCOME_8L', pg_temp.rule('{"maxAnnualIncome":800000}'));
SELECT pg_temp.add_scheme('T_INCOME_12L', pg_temp.rule('{"maxAnnualIncome":1200000}'));
SELECT pg_temp.add_scheme('T_BIHAR_ONLY', pg_temp.rule('{"states":["IN-BR"]}'));
SELECT pg_temp.add_scheme('T_SC_ST_ONLY', pg_temp.rule('{"socialCategory":["SC","ST"]}'));
SELECT pg_temp.add_scheme('T_FARMER_LAND_2HA', pg_temp.rule('{"occupation":["FARMER"],"maxLandHolding":2}'));
SELECT pg_temp.add_scheme('T_WOMEN_ONLY', pg_temp.rule('{"gender":"FEMALE"}'));
SELECT pg_temp.add_scheme('T_DISABILITY', pg_temp.rule('{"requiresDisability":true}'));
SELECT pg_temp.add_scheme('T_STUDENT', pg_temp.rule('{"isStudentOnly":true,"occupation":["STUDENT"]}'));

-- A Bihar farmer: 34, male, OBC, ₹1L–2.5L bracket, 1.2 hectares. Fully answered,
-- so no criterion can come back UNKNOWN except a straddled income cap.
CREATE FUNCTION pg_temp.ramesh() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "age": 34,
    "gender": "MALE",
    "annualIncomeLower": 100000,
    "annualIncomeUpper": 250000,
    "occupation": "FARMER",
    "socialCategory": "OBC",
    "state": "IN-BR",
    "landHolding": 1.2,
    "isStudent": false,
    "hasDisability": false
  }'::jsonb;
$$;

-- ---------------------------------------------------------------------------
-- Numeric bounds
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('unrestricted rule passes everything',
  pg_temp.verdict(pg_temp.ramesh(), 'T_OPEN', 'minAge'), 'PASS');
SELECT pg_temp.expect('age 34 satisfies minAge 18',
  pg_temp.verdict(pg_temp.ramesh(), 'T_AGE_18_40', 'minAge'), 'PASS');
SELECT pg_temp.expect('age 34 satisfies maxAge 40',
  pg_temp.verdict(pg_temp.ramesh(), 'T_AGE_18_40', 'maxAge'), 'PASS');
SELECT pg_temp.expect('age 50 exceeds maxAge 40',
  pg_temp.verdict('{"age":50}', 'T_AGE_18_40', 'maxAge'), 'FAIL');
SELECT pg_temp.expect('age 12 falls below minAge 18',
  pg_temp.verdict('{"age":12}', 'T_AGE_18_40', 'minAge'), 'FAIL');
SELECT pg_temp.expect('undisclosed age is UNKNOWN, not a rejection',
  pg_temp.verdict('{}', 'T_AGE_18_40', 'minAge'), 'UNKNOWN');
SELECT pg_temp.expect('minAge is inclusive at the boundary',
  pg_temp.verdict('{"age":18}', 'T_AGE_18_40', 'minAge'), 'PASS');
SELECT pg_temp.expect('maxAge is inclusive at the boundary',
  pg_temp.verdict('{"age":40}', 'T_AGE_18_40', 'maxAge'), 'PASS');

-- ---------------------------------------------------------------------------
-- Income brackets versus a single cap
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('bracket ending exactly at the cap passes',
  pg_temp.verdict(pg_temp.ramesh(), 'T_INCOME_2_5L', 'maxAnnualIncome'), 'PASS');
SELECT pg_temp.expect('bracket comfortably under the cap passes',
  pg_temp.verdict(pg_temp.ramesh(), 'T_INCOME_8L', 'maxAnnualIncome'), 'PASS');
SELECT pg_temp.expect('bracket straddling the cap is UNKNOWN',
  pg_temp.verdict(pg_temp.ramesh(), 'T_INCOME_2L', 'maxAnnualIncome'), 'UNKNOWN');
SELECT pg_temp.expect('open-ended top bracket fails a low cap',
  pg_temp.verdict('{"annualIncomeLower":1000000}', 'T_INCOME_2_5L', 'maxAnnualIncome'), 'FAIL');
SELECT pg_temp.expect('open-ended top bracket under a high cap is UNKNOWN',
  pg_temp.verdict('{"annualIncomeLower":1000000}', 'T_INCOME_12L', 'maxAnnualIncome'), 'UNKNOWN');
SELECT pg_temp.expect('undisclosed income is UNKNOWN',
  pg_temp.verdict('{}', 'T_INCOME_2_5L', 'maxAnnualIncome'), 'UNKNOWN');
SELECT pg_temp.expect('absent cap makes income irrelevant',
  pg_temp.verdict('{}', 'T_OPEN', 'maxAnnualIncome'), 'PASS');
SELECT pg_temp.expect('needsIncomeVerification flags the straddling case',
  (SELECT m."needsIncomeVerification"::text
   FROM public.match_schemes(pg_temp.ramesh(), 10) m WHERE m."name" = 'T_INCOME_2L'), 'true');
SELECT pg_temp.expect('needsIncomeVerification is false for a clean pass',
  (SELECT m."needsIncomeVerification"::text
   FROM public.match_schemes(pg_temp.ramesh(), 10) m WHERE m."name" = 'T_INCOME_8L'), 'false');

-- ---------------------------------------------------------------------------
-- Categorical criteria and the '*' wildcard
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('resident of a listed state passes',
  pg_temp.verdict(pg_temp.ramesh(), 'T_BIHAR_ONLY', 'states'), 'PASS');
SELECT pg_temp.expect('resident of an unlisted state fails',
  pg_temp.verdict('{"state":"IN-UP"}', 'T_BIHAR_ONLY', 'states'), 'FAIL');
SELECT pg_temp.expect('undisclosed state is UNKNOWN',
  pg_temp.verdict('{}', 'T_BIHAR_ONLY', 'states'), 'UNKNOWN');
SELECT pg_temp.expect('wildcard state list passes without knowing the state',
  pg_temp.verdict('{}', 'T_OPEN', 'states'), 'PASS');
SELECT pg_temp.expect('OBC applicant fails an SC/ST-only scheme',
  pg_temp.verdict(pg_temp.ramesh(), 'T_SC_ST_ONLY', 'socialCategory'), 'FAIL');
SELECT pg_temp.expect('SC applicant passes an SC/ST-only scheme',
  pg_temp.verdict('{"socialCategory":"SC"}', 'T_SC_ST_ONLY', 'socialCategory'), 'PASS');
SELECT pg_temp.expect('farmer passes an occupation-restricted scheme',
  pg_temp.verdict(pg_temp.ramesh(), 'T_FARMER_LAND_2HA', 'occupation'), 'PASS');
SELECT pg_temp.expect('weaver fails a farmer-only scheme',
  pg_temp.verdict('{"occupation":"WEAVER"}', 'T_FARMER_LAND_2HA', 'occupation'), 'FAIL');
SELECT pg_temp.expect('male applicant fails a women-only scheme',
  pg_temp.verdict(pg_temp.ramesh(), 'T_WOMEN_ONLY', 'gender'), 'FAIL');
SELECT pg_temp.expect('female applicant passes a women-only scheme',
  pg_temp.verdict('{"gender":"FEMALE"}', 'T_WOMEN_ONLY', 'gender'), 'PASS');
SELECT pg_temp.expect('undisclosed gender is UNKNOWN',
  pg_temp.verdict('{}', 'T_WOMEN_ONLY', 'gender'), 'UNKNOWN');

-- ---------------------------------------------------------------------------
-- Land holding and boolean requirements
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('1.2 ha sits within a 2 ha ceiling',
  pg_temp.verdict(pg_temp.ramesh(), 'T_FARMER_LAND_2HA', 'maxLandHolding'), 'PASS');
SELECT pg_temp.expect('2.5 ha exceeds a 2 ha ceiling',
  pg_temp.verdict('{"landHolding":2.5}', 'T_FARMER_LAND_2HA', 'maxLandHolding'), 'FAIL');
SELECT pg_temp.expect('exactly 2 ha passes an inclusive ceiling',
  pg_temp.verdict('{"landHolding":2}', 'T_FARMER_LAND_2HA', 'maxLandHolding'), 'PASS');
SELECT pg_temp.expect('a landless applicant passes a land ceiling',
  pg_temp.verdict('{"landHolding":0}', 'T_FARMER_LAND_2HA', 'maxLandHolding'), 'PASS');
SELECT pg_temp.expect('no disability fails a disability-only scheme',
  pg_temp.verdict(pg_temp.ramesh(), 'T_DISABILITY', 'requiresDisability'), 'FAIL');
SELECT pg_temp.expect('disability passes a disability-only scheme',
  pg_temp.verdict('{"hasDisability":true}', 'T_DISABILITY', 'requiresDisability'), 'PASS');
SELECT pg_temp.expect('unasked disability is UNKNOWN',
  pg_temp.verdict('{}', 'T_DISABILITY', 'requiresDisability'), 'UNKNOWN');
SELECT pg_temp.expect('a scheme without a disability requirement excludes nobody',
  pg_temp.verdict('{}', 'T_OPEN', 'requiresDisability'), 'PASS');
SELECT pg_temp.expect('non-student fails a student-only scheme',
  pg_temp.verdict(pg_temp.ramesh(), 'T_STUDENT', 'isStudentOnly'), 'FAIL');
SELECT pg_temp.expect('student passes a student-only scheme',
  pg_temp.verdict('{"isStudent":true,"occupation":"STUDENT"}', 'T_STUDENT', 'isStudentOnly'), 'PASS');

-- ---------------------------------------------------------------------------
-- Result shaping: eligibility, near misses, filters, scoring
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect('an empty profile rules nothing out',
  pg_temp.match_count('{}'::jsonb, 0), pg_temp.fixture_count());
SELECT pg_temp.expect('a fully answered profile returns only genuine matches',
  pg_temp.match_count(pg_temp.ramesh(), 0), '8');
SELECT pg_temp.expect('near-miss mode adds single-criterion failures',
  pg_temp.match_count(pg_temp.ramesh(), 1), '11');
SELECT pg_temp.expect('two-failure scheme only appears at max_failures >= 2',
  pg_temp.match_count(pg_temp.ramesh(), 2), '12');
SELECT pg_temp.expect('isEligible is false once a criterion fails',
  (SELECT m."isEligible"::text FROM public.match_schemes(pg_temp.ramesh(), 3) m
   WHERE m."name" = 'T_WOMEN_ONLY'), 'false');
SELECT pg_temp.expect('failedCriteria names the blocking criterion',
  (SELECT array_to_string(m."failedCriteria", ',') FROM public.match_schemes(pg_temp.ramesh(), 3) m
   WHERE m."name" = 'T_WOMEN_ONLY'), 'gender');
-- Criteria come back in the canonical ELIGIBILITY_CRITERIA order, not alphabetical.
SELECT pg_temp.expect('unverifiedCriteria lists both age checks for an empty profile',
  (SELECT array_to_string(m."unverifiedCriteria", ',') FROM public.match_schemes('{}'::jsonb, 0) m
   WHERE m."name" = 'T_AGE_18_40'), 'minAge,maxAge');
SELECT pg_temp.expect('a fully confirmed match scores 100',
  (SELECT m."matchScore"::text FROM public.match_schemes(pg_temp.ramesh(), 0) m
   WHERE m."name" = 'T_OPEN'), '100');
SELECT pg_temp.expect('each unverified criterion costs 8 points',
  (SELECT m."matchScore"::text FROM public.match_schemes(pg_temp.ramesh(), 0) m
   WHERE m."name" = 'T_INCOME_2L'), '92');
SELECT pg_temp.expect('category filter excludes other categories',
  pg_temp.match_count('{}'::jsonb, 0, 'AGRICULTURE'), '0');
SELECT pg_temp.expect('category filter keeps matching categories',
  pg_temp.match_count('{}'::jsonb, 0, 'OTHER'), pg_temp.fixture_count());

-- ---------------------------------------------------------------------------
-- The shape guard must reject un-normalized eligibility JSON
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM pg_temp.add_scheme('T_BAD_MISSING_KEYS', '{"minAge": 18}'::jsonb);
    RAISE EXCEPTION 'FAIL: CHECK accepted eligibility JSON missing categorical keys';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok   CHECK rejects eligibility missing categorical keys';
  END;

  BEGIN
    PERFORM pg_temp.add_scheme('T_BAD_EMPTY_ARRAY', pg_temp.rule('{"states":[]}'));
    RAISE EXCEPTION 'FAIL: CHECK accepted an empty states array';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok   CHECK rejects an empty categorical array';
  END;

  BEGIN
    PERFORM pg_temp.add_scheme('T_BAD_TYPE', pg_temp.rule('{"minAge":"eighteen"}'));
    RAISE EXCEPTION 'FAIL: CHECK accepted a string where a number belongs';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok   CHECK rejects a mistyped numeric bound';
  END;
END $$;

DO $$ BEGIN RAISE NOTICE '--- all match_schemes() expectations passed ---'; END $$;

ROLLBACK;
