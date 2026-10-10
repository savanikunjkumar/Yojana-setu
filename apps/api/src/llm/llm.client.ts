/**
 * The one LLM client in this project.
 *
 * Framework-agnostic on purpose (no Nest decorators, no imports from `@nestjs/*`)
 * so both callers can share it: the scraper's eligibility normaliser, which runs
 * under `tsx` from `scripts/`, and the voice layer's profile extractor, which runs
 * inside the API. Anything OpenAI-compatible works — OpenAI, Groq, OpenRouter,
 * Together, a local Ollama — by changing `LLM_BASE_URL`.
 */

export interface LlmSettings {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  temperature: number;
  timeoutMs: number;
  /**
   * Optional wall-clock budget for the whole call, retries and rate-limit waits included.
   *
   * `timeoutMs` bounds a single attempt. That is the right shape for the scraper, where
   * waiting out a 429 is exactly what should happen — the run is a batch job and the
   * provider has said precisely how long to wait. It is the wrong shape in front of a person
   * mid-sentence: honouring a retry-after can push one turn past ten seconds even though
   * every individual attempt respected an eight-second timeout, which is how a turn measured
   * 11.7 s against an 8 s setting.
   *
   * Unset means the previous behaviour, so the scraper is unaffected.
   */
  deadlineMs?: number;
  maxRetries: number;
}

/**
 * Loads settings, optionally from a prefixed set of variables that fall back to the
 * unprefixed ones.
 *
 * The two callers want different models and that is not a preference — it is a latency
 * requirement. Rate limits on Groq are **per model**, so pointing scheme normalisation and
 * voice extraction at the same model makes them compete for one tokens-per-minute bucket:
 * a background scrape then starves the interactive path, which is how a voice turn came to
 * take 74 seconds. Different models mean different buckets and no contention.
 *
 * They also want different things from a model. Normalising a scheme is a careful read of
 * legal prose where strict `json_schema` support matters; extracting a spoken sentence is
 * simpler and needs to feel instant.
 */
export function llmSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: { prefix?: string; defaultModel?: string; defaultTimeoutMs?: number } = {},
): LlmSettings {
  const prefix = options.prefix ?? '';
  const pick = (name: string): string | undefined =>
    (prefix ? env[`${prefix}${name}`] : undefined) ?? env[name];

  return {
    baseUrl: pick('LLM_BASE_URL') ?? 'https://api.openai.com/v1',
    apiKey: pick('LLM_API_KEY') ?? env.OPENAI_API_KEY,
    model: pick('LLM_MODEL') ?? options.defaultModel ?? 'gpt-4o-mini',
    // Zero temperature: reading a legal document is transcription, not composition.
    temperature: 0,
    timeoutMs: Number(pick('LLM_TIMEOUT_MS') ?? options.defaultTimeoutMs ?? 60_000),
    maxRetries: Number(pick('LLM_MAX_RETRIES') ?? 2),
  };
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Provider rejected `response_format: json_schema`; retry in JSON-object mode. */
    readonly unsupportedResponseFormat = false,
    /** Milliseconds the provider asked us to wait, from a 429. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Cap on an honoured Retry-After, so a hostile or buggy header cannot stall a run. */
const MAX_RETRY_AFTER_MS = 90_000;

/**
 * How long to wait after a 429.
 *
 * Providers say precisely how long — Groq sends a `retry-after` header and repeats it
 * in prose ("Please try again in 9.93s"). Ignoring that and using a short exponential
 * backoff means every retry fails too, which is how a rate limit turns into a pile of
 * bogus "could not interpret this scheme" rejections rather than a slower run.
 */
function parseRetryAfter(headers: Headers, body: string): number | null {
  const header = headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    const asDate = Date.parse(header);
    if (Number.isFinite(asDate)) {
      return Math.min(Math.max(asDate - Date.now(), 0), MAX_RETRY_AFTER_MS);
    }
  }

  const fromBody = body.match(/try again in\s+([\d.]+)\s*(ms|s|m)?/i);
  if (fromBody) {
    const value = Number.parseFloat(fromBody[1] ?? '');
    if (Number.isFinite(value)) {
      const unit = fromBody[2]?.toLowerCase() ?? 's';
      const ms = unit === 'ms' ? value : unit === 'm' ? value * 60_000 : value * 1000;
      return Math.min(ms, MAX_RETRY_AFTER_MS);
    }
  }

  return null;
}

export interface JsonCompletionRequest {
  system: string;
  user: string;
  /** Name reported to the provider's structured-output mode. */
  schemaName: string;
  /** JSON Schema. Needs `additionalProperties: false` and every key in `required`. */
  schema: Record<string, unknown>;
  maxTokens?: number;
}

/**
 * Not every OpenAI-compatible provider supports `response_format: json_schema`.
 * Groq's `llama-3.3-70b-versatile`, for instance, answers 400 — which would have
 * failed every single normalisation call. So the first rejection downgrades the
 * whole process to JSON-object mode with the schema pasted into the prompt, and the
 * answer is cached per model so only one request pays the probe.
 *
 * Downgrading is safe because the caller validates with Zod regardless: a provider
 * that merely *tries* to honour the shape cannot get anything past that gate.
 */
const jsonSchemaSupport = new Map<string, boolean>();

/** True when this model is known not to support strict structured output. */
export function isJsonSchemaDowngraded(model: string): boolean {
  return jsonSchemaSupport.get(model) === false;
}

/**
 * Requests a JSON object matching `schema`. Returns the parsed object without
 * validating it — callers own validation, since they own the Zod schema that is the
 * real contract.
 */
export async function completeJson(
  request: JsonCompletionRequest,
  settings: LlmSettings,
): Promise<Record<string, unknown>> {
  if (!settings.apiKey) {
    throw new LlmError('No LLM credentials. Set LLM_API_KEY (or OPENAI_API_KEY) in .env.', false);
  }

  let lastError: LlmError | null = null;
  // Rate limits get their own, larger budget: unlike a malformed request they are
  // guaranteed to clear, and the provider tells us exactly when.
  let rateLimitAttempts = 0;
  const maxRateLimitAttempts = 6;

  const deadlineAt = settings.deadlineMs ? Date.now() + settings.deadlineMs : null;
  const remainingMs = (): number => (deadlineAt === null ? Infinity : deadlineAt - Date.now());
  const expired = (): LlmError =>
    new LlmError(`LLM call exceeded its ${settings.deadlineMs}ms budget`, true);

  for (let attempt = 0; attempt <= settings.maxRetries; attempt += 1) {
    const useStrictSchema = jsonSchemaSupport.get(settings.model) !== false;

    if (remainingMs() <= 0) throw lastError ?? expired();

    try {
      // An attempt may never outlive the overall budget, so the two are taken together.
      return await requestOnce(request, settings, useStrictSchema, remainingMs());
    } catch (error) {
      const llmError =
        error instanceof LlmError ? error : new LlmError((error as Error).message, true);

      // A provider that cannot do strict schemas is not a failure, it is a
      // capability discovery: record it and retry immediately without backoff.
      if (llmError.unsupportedResponseFormat && useStrictSchema) {
        jsonSchemaSupport.set(settings.model, false);
        attempt -= 1;
        continue;
      }

      if (llmError.retryAfterMs !== null && rateLimitAttempts < maxRateLimitAttempts) {
        // Waiting past the deadline helps nobody: the caller has already given up by then,
        // and the retry would only spend rate-limit budget the next turn needs.
        if (llmError.retryAfterMs + 250 >= remainingMs()) throw llmError;

        rateLimitAttempts += 1;
        // A honoured wait is not a failed attempt, so it must not consume the budget
        // reserved for genuine errors.
        attempt -= 1;
        await sleep(llmError.retryAfterMs + 250);
        continue;
      }

      lastError = llmError;
      if (!llmError.retryable) throw llmError;

      const backoff = 1000 * 2 ** attempt;
      if (backoff >= remainingMs()) throw llmError;
      if (attempt < settings.maxRetries) await sleep(backoff);
    }
  }

  throw lastError ?? new LlmError('LLM request failed', false);
}

async function requestOnce(
  request: JsonCompletionRequest,
  settings: LlmSettings,
  useStrictSchema: boolean,
  budgetMs = Infinity,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const attemptMs = Math.min(settings.timeoutMs, budgetMs);
  const timeout = setTimeout(() => controller.abort(), attemptMs);

  // Without strict mode the model has no machine-readable contract, so the schema
  // goes into the prompt instead.
  const system = useStrictSchema
    ? request.system
    : `${request.system}\n\nReply with JSON only, matching this JSON Schema exactly:\n${JSON.stringify(
        request.schema,
      )}`;

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: request.user },
        ],
        response_format: useStrictSchema
          ? {
              type: 'json_schema',
              json_schema: { name: request.schemaName, strict: true, schema: request.schema },
            }
          : { type: 'json_object' },
      }),
    });
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    throw new LlmError(
      aborted
        ? `timed out after ${attemptMs}ms`
        : `network error: ${(error as Error).message}`,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const unsupported =
      response.status === 400 && /response.?format|json_schema|structured output/i.test(body);
    const retryAfterMs =
      response.status === 429 ? (parseRetryAfter(response.headers, body) ?? 10_000) : null;

    throw new LlmError(
      `HTTP ${response.status}: ${body.slice(0, 300)}`,
      // 429 and 5xx are transient; a 400 will fail identically forever.
      response.status === 429 || response.status >= 500,
      unsupported,
      retryAfterMs,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string };
  };

  if (payload.error?.message) throw new LlmError(payload.error.message, false);

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new LlmError('response contained no message content', true);

  return parseJsonObject(content);
}

/**
 * Models in JSON-object mode sometimes wrap output in a ```json fence or add a
 * sentence around it, so the outermost object is extracted rather than assuming the
 * whole body parses.
 */
function parseJsonObject(content: string): Record<string, unknown> {
  const withoutFence = content
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  const candidates = [withoutFence];
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new LlmError(`response was not a JSON object: ${content.slice(0, 200)}`, true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
