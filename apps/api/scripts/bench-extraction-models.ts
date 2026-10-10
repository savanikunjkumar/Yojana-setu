/**
 * Compares candidate models for voice profile extraction on speed AND accuracy.
 *
 *   npx tsx scripts/bench-extraction-models.ts
 *
 * The token accounting showed the prompt is only ~1,000 tokens, which is well inside an
 * 8,000 TPM budget — so rate limiting cannot explain a 74-second turn. The remaining
 * suspect is the model itself: `gpt-oss-*` are reasoning models that emit chain-of-thought
 * before their answer, and that thinking is billed in completion tokens and paid for in
 * wall-clock seconds.
 *
 * This measures each candidate on the real extraction prompt and checks the answer, so
 * the choice is made on evidence rather than on which model sounds fastest. Accuracy is
 * scored against the same expectations the regression suite uses: what must be extracted,
 * and — more importantly — what must stay null.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXTRACTION_SCHEMA, SYSTEM_PROMPT } from '../src/voice/profile-extraction.service';

const env = loadEnv();

const ONLY = process.argv.slice(2).find((a) => a.startsWith('--model='))?.split('=')[1];

const CANDIDATES = [
  { model: 'openai/gpt-oss-120b', strictSchema: true },
  { model: 'openai/gpt-oss-20b', strictSchema: true },
  { model: 'llama-3.3-70b-versatile', strictSchema: false },
  { model: 'llama-3.1-8b-instant', strictSchema: false },
].filter((candidate) => !ONLY || candidate.model === ONLY);

interface Expectation {
  label: string;
  transcript: string;
  /** Fields that must be extracted, with their required value. */
  must: Record<string, unknown>;
  /** Fields that must stay null — guessing any of these is the dangerous failure. */
  mustBeNull: string[];
}

const CASES: Expectation[] = [
  {
    label: 'plain facts',
    transcript: 'main 34 saal ka hoon, bihar se hoon, aur kisan hoon',
    must: { age: 34, state: 'IN-BR', occupation: 'FARMER' },
    mustBeNull: ['incomeBracket', 'socialCategory', 'hasDisability'],
  },
  {
    label: 'the never-guess case',
    transcript: 'mera beta college jaa raha hai aur ghar ki income kam hai, main UP se hoon',
    must: { state: 'IN-UP' },
    // The college is the son's and "income kam hai" states no figure.
    mustBeNull: ['isStudent', 'incomeBracket', 'age', 'occupation'],
  },
  {
    label: 'income with a figure',
    transcript: 'meri saal ki kamai ek lakh pachas hazaar hai aur main 40 saal ki mahila hoon',
    must: { incomeBracket: 'INR_1L_TO_2_5L', age: 40, gender: 'FEMALE' },
    mustBeNull: ['occupation', 'landHolding'],
  },
  {
    label: 'status question, not details',
    transcript: 'meri applications ka kya status hai',
    must: { intent: 'ASK_APPLICATION_STATUS' },
    mustBeNull: ['age', 'state', 'occupation', 'incomeBracket'],
  },
];

async function main(): Promise<void> {
  console.log('Extraction model comparison — speed and accuracy on the real prompt\n');

  for (const candidate of CANDIDATES) {
    const timings: number[] = [];
    const completionTokens: number[] = [];
    let correct = 0;
    let guessed = 0;
    let failed = 0;
    const notes: string[] = [];

    for (const testCase of CASES) {
      const result = await callModel(candidate, testCase.transcript);

      if (!result.ok) {
        failed += 1;
        notes.push(`${testCase.label}: ${result.error}`);
        continue;
      }

      timings.push(result.ms);
      completionTokens.push(result.completionTokens);

      const missing = Object.entries(testCase.must).filter(
        ([field, value]) => result.payload[field] !== value,
      );
      const invented = testCase.mustBeNull.filter(
        (field) => result.payload[field] !== null && result.payload[field] !== undefined,
      );

      if (missing.length === 0 && invented.length === 0) {
        correct += 1;
      } else {
        if (invented.length > 0) guessed += 1;
        notes.push(
          `${testCase.label}: ${[
            missing.length ? `missed ${missing.map(([f, v]) => `${f}=${String(v)}`).join(',')}` : '',
            invented.length ? `INVENTED ${invented.join(',')}` : '',
          ]
            .filter(Boolean)
            .join(' | ')}`,
        );
      }

      // Stay inside the shared token budget between candidates.
      await sleep(1500);
    }

    const median = timings.length ? percentile(timings, 50) : 0;
    const worst = timings.length ? Math.max(...timings) : 0;
    const medianCompletion = completionTokens.length ? percentile(completionTokens, 50) : 0;

    console.log(`${candidate.model}${candidate.strictSchema ? '' : '  (json_object mode)'}`);
    console.log(`  latency        p50 ${median}ms   max ${worst}ms`);
    console.log(`  completion     ${medianCompletion} tokens (median) — reasoning shows up here`);
    console.log(`  accuracy       ${correct}/${CASES.length} cases fully correct`);
    console.log(`  invented data  ${guessed} case(s)  ${guessed > 0 ? '← disqualifying' : ''}`);
    if (failed > 0) console.log(`  failed         ${failed} call(s)`);
    notes.forEach((note) => console.log(`    · ${note}`));
    console.log('');
  }
}

type ModelResult =
  | { ok: true; ms: number; completionTokens: number; payload: Record<string, unknown> }
  | { ok: false; error: string };

async function callModel(
  candidate: { model: string; strictSchema: boolean },
  transcript: string,
): Promise<ModelResult> {
  const user = `Language hint: hi-IN\n\nFields already known from earlier turns:\n  (nothing known yet)\n\nThe person just said:\n${transcript}`;

  const system = candidate.strictSchema
    ? SYSTEM_PROMPT
    : `${SYSTEM_PROMPT}\n\nReply with JSON only, matching this JSON Schema exactly:\n${JSON.stringify(EXTRACTION_SCHEMA)}`;

  const body: Record<string, unknown> = {
    model: candidate.model,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: candidate.strictSchema
      ? { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: EXTRACTION_SCHEMA } }
      : { type: 'json_object' },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  const started = Date.now();

  try {
    const response = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const ms = Date.now() - started;

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, error: `HTTP ${response.status} ${text.slice(0, 80)}` };
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { completion_tokens?: number };
    };

    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed) return { ok: false, error: `unparseable: ${content.slice(0, 60)}` };

    return {
      ok: true,
      ms,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      payload: parsed,
    };
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    return { ok: false, error: aborted ? 'timeout >90s' : `${(error as Error).message}`.slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(content: string): Record<string, unknown> | null {
  const cleaned = content
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  for (const candidate of [cleaned, start !== -1 ? cleaned.slice(start, end + 1) : '']) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv(): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(resolve(__dirname, '../../../.env'), 'utf8').split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    parsed[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, '');
  }
  return parsed;
}

void main();
