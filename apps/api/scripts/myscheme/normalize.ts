import { ANY, safeNormalizeEligibility, type EligibilityRule } from '@sih/shared';
import type { ScrapeConfig } from './config';
import { eligibilityProse } from './extract';
import { checkGrounding, checkPlausibility, describeCategoricalEvidence } from './grounding';
import { recoverOccupationGate } from './mapping';
import { extractWithLlm, LlmError, type LlmExtraction } from './normalize-llm';
import { DEPRIVATION, extractWithRules } from './normalize-rules';
import { truncate } from './text';
import type { NormalizedScheme, ProxyNote, RawScheme, RejectionDetail } from './types';

export type NormalizeOutcome =
  { ok: true; value: NormalizedScheme } | { ok: false; rejection: RejectionDetail };

/**
 * Turns eligibility prose into a validated `EligibilityRule`.
 *
 * The order of the steps is the point of this function:
 *
 *   1. extract        — LLM or rules, both returning the same loose shape
 *   2. infer state    — a state-administered scheme restricts to that state
 *   3. Zod            — the project's own normalizer is the only gate to the DB
 *   4. grounding      — every number must be traceable to the source prose
 *   5. PROXY          — only now may a synthetic income ceiling be added
 *
 * Grounding sits *before* the proxy deliberately. The proxy ceiling is a number we
 * invent on purpose, so it would fail its own grounding check; applying it last
 * keeps that exemption narrow and explicit instead of loosening the check.
 *
 * Zod runs before grounding because a shape error should be reported as a shape
 * error, and because a rule that Zod rejects has no meaningful numbers to ground.
 */
export async function normalizeScheme(
  scheme: RawScheme,
  config: ScrapeConfig,
): Promise<NormalizeOutcome> {
  const prose = eligibilityProse(scheme);
  const notes: string[] = [];

  if (prose.trim().length < 15) {
    return {
      ok: false,
      rejection: {
        stage: 'normalize',
        reason: 'eligibility prose is empty or too short to interpret',
        prose,
      },
    };
  }

  let extraction: LlmExtraction;
  try {
    extraction =
      config.normalizer === 'llm'
        ? await extractWithLlm(
            { name: scheme.name, prose, tags: scheme.tags, state: scheme.state },
            config.llm,
          )
        : extractWithRules({ prose, name: scheme.name });
  } catch (error) {
    return {
      ok: false,
      rejection: {
        stage: 'normalize',
        reason: `${config.normalizer} normaliser failed: ${(error as Error).message}`,
        prose,
        // Anything thrown by the LLM client is an infrastructure problem, not a
        // verdict on the prose, so it must remain retryable.
        transient: error instanceof LlmError,
      },
    };
  }

  const withScope = applyStateScope(extraction.rule, scheme);
  const withOccupation = applyOccupationRecovery(withScope, prose, notes);

  const parsed = safeNormalizeEligibility(withOccupation);
  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        stage: 'zod',
        reason: 'normalised rule failed Zod validation',
        details: parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
        prose,
      },
    };
  }

  let rule: EligibilityRule = parsed.data;

  const groundingFailures = [...checkGrounding(rule, prose), ...checkPlausibility(rule)];
  if (groundingFailures.length > 0) {
    return {
      ok: false,
      rejection: {
        stage: 'grounding',
        reason: 'numeric bounds are unsupported by, or implausible for, the source prose',
        details: groundingFailures.map((failure) => failure.reason),
        prose,
      },
    };
  }

  const weakEvidence = describeCategoricalEvidence(rule, prose);

  const proxyResult = applyDeprivationProxy(rule, extraction, scheme, prose, config);
  if (proxyResult.rejection) {
    return { ok: false, rejection: proxyResult.rejection };
  }
  rule = proxyResult.rule;

  const noteText = [
    extraction.notes,
    ...notes,
    ...weakEvidence.map((note) => `weak evidence: ${note}`),
  ]
    .filter(Boolean)
    .join('; ');

  return {
    ok: true,
    value: {
      rule,
      proxy: proxyResult.proxy,
      notes: truncate(noteText, 500),
      normalizer: config.normalizer,
    },
  };
}

/**
 * Recovers an occupation gate the normaliser missed or fudged.
 *
 * Applies in exactly two situations, both observed in real output:
 *
 *   - the rule is unrestricted (`['*']`) while the prose plainly says "the applicant
 *     should be a Roadside Cobbler". Left alone, the scheme is offered to everyone.
 *   - the rule is `['OTHER']`, which is what a model reaches for when it recognises an
 *     occupation requirement but sees no matching enum value. That is *worse* than the
 *     wildcard: `OTHER` fails every applicant who picked a real occupation, so a
 *     construction worker is actively excluded from a construction-worker scheme.
 *
 * A specific, non-empty answer from the normaliser is never overridden; this only fills
 * a gap, and only from an unambiguous "the applicant must be a …" clause.
 */
function applyOccupationRecovery(
  rule: Record<string, unknown>,
  prose: string,
  notes: string[],
): Record<string, unknown> {
  const current = Array.isArray(rule.occupation) ? (rule.occupation as string[]) : [];
  const isWildcard = current.length === 0 || current.includes(ANY);
  const isOtherOnly = current.length === 1 && current[0] === 'OTHER';

  if (!isWildcard && !isOtherOnly) return rule;

  const recovered = recoverOccupationGate(prose);
  if (!recovered) return rule;

  notes.push(
    isOtherOnly
      ? `replaced occupation OTHER with ${recovered.join('/')} read from the prose`
      : `recovered occupation ${recovered.join('/')} from an explicit applicant requirement`,
  );

  return { ...rule, occupation: recovered };
}

/**
 * A scheme administered by a state is only open to that state's residents, but the
 * prose almost never says so — it says "permanent resident of the State". The
 * administering state comes from the page header, so it is applied here rather than
 * left to the model to guess.
 *
 * Only fills a wildcard: if the prose named specific states, that is more precise
 * than the header and is left alone.
 */
function applyStateScope(
  rule: Record<string, unknown>,
  scheme: RawScheme,
): Record<string, unknown> {
  if (scheme.state === null) return rule;

  const states = rule.states;
  const isWildcard =
    !Array.isArray(states) || states.length === 0 || states.every((value) => value === ANY);

  if (!isWildcard) return rule;

  return { ...rule, states: [scheme.state] };
}

/**
 * Schemes that select beneficiaries from SECC 2011 / BPL / Antyodaya lists have no
 * income figure to extract, so matching them on income is impossible as written.
 * seed.ts handles the same problem by standing in an income ceiling and marking the
 * entry PROXY; this does the same, records every application for review, and never
 * overwrites a real cap that was actually stated.
 */
function applyDeprivationProxy(
  rule: EligibilityRule,
  extraction: LlmExtraction,
  scheme: RawScheme,
  prose: string,
  config: ScrapeConfig,
): { rule: EligibilityRule; proxy: ProxyNote | null; rejection?: RejectionDetail } {
  const triggerMatch = prose.match(DEPRIVATION);
  const flagged = extraction.usesDeprivationCriteria || triggerMatch !== null;

  if (!flagged || rule.maxAnnualIncome !== null) {
    return { rule, proxy: null };
  }

  const proxied = safeNormalizeEligibility({
    ...rule,
    maxAnnualIncome: config.proxyIncomeCeiling,
  });

  if (!proxied.success) {
    return {
      rule,
      proxy: null,
      rejection: {
        stage: 'zod',
        reason: 'applying the deprivation income proxy produced an invalid rule',
        details: proxied.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
        prose,
      },
    };
  }

  return {
    rule: proxied.data,
    proxy: {
      schemeName: scheme.name,
      sourceUrl: scheme.sourceUrl,
      trigger: triggerMatch?.[0] ?? 'model flagged deprivation criteria',
      appliedIncomeCeiling: config.proxyIncomeCeiling,
      prose: truncate(prose, 400),
    },
  };
}
