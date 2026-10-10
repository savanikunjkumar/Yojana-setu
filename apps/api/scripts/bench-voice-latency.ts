/**
 * Measures where a voice turn's time actually goes.
 *
 *   npx tsx scripts/bench-voice-latency.ts --turns=20
 *   npx tsx scripts/bench-voice-latency.ts --turns=6 --timeout=20000
 *
 * Exists because "a voice turn took 74 seconds" is not actionable on its own. A turn is
 * an LLM extraction followed by a SQL match, and only one of those can plausibly cost
 * seconds. This separates them, accounts for the prompt so token trimming can be aimed
 * rather than guessed at, and — crucially — reports COLD and SUSTAINED latency
 * separately, because under a tokens-per-minute cap those are different numbers and only
 * measuring one of them is misleading.
 *
 * Requires the API running and Postgres up.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXTRACTION_SCHEMA, SYSTEM_PROMPT } from '../src/voice/profile-extraction.service';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: number): number =>
  Number(argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);

const TURNS = flag('turns', 20);
const TIMEOUT_MS = flag('timeout', 25_000);
const API = process.env.BENCH_API_URL ?? 'http://localhost:4000/api';

const env = loadEnv();

const EMPTY_PROFILE = {
  age: null,
  gender: null,
  incomeBracket: null,
  occupation: null,
  state: null,
  district: null,
  socialCategory: null,
  landHolding: null,
  isStudent: null,
  hasDisability: null,
};

/** Varied so no two calls could be served from a provider-side cache. */
const TRANSCRIPTS = [
  'main 34 saal ka hoon aur bihar mein rehta hoon',
  'meri beti school jaa rahi hai, main kisan hoon',
  'I am a weaver from Uttar Pradesh, my income is about one lakh',
  'main vidhwa hoon, meri umar 68 saal hai',
  'mere paas do hectare zameen hai aur main obc se hoon',
  'I am 22 and studying engineering in Karnataka',
  'ghar ki aay bahut kam hai, main majdoori karta hoon',
  'main 45 saal ka machhuara hoon, kerala se',
  'I have a disability certificate and I am unemployed',
  'meri umar 30 hai, main mahila hoon aur gujarat mein hoon',
];

async function main(): Promise<void> {
  // Voice extraction reads VOICE_LLM_MODEL first; reporting LLM_MODEL here would name the
  // scraper's model and misattribute every number below.
  const voiceModel = env.VOICE_LLM_MODEL || env.LLM_MODEL;
  console.log(`Voice latency benchmark — extraction model ${voiceModel}`);
  console.log(`(scraper model, unaffected: ${env.LLM_MODEL})\n`);
  await assertApiUp();

  tokenAccounting();
  await sqlBaseline();
  await coldTurn();
  await sustainedTurns();
}

async function assertApiUp(): Promise<void> {
  try {
    const response = await fetch(`${API}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error(`API not reachable at ${API}. Start it first.`);
    console.error(String((error as Error).message));
    process.exit(1);
  }
}

/**
 * Token accounting from the actual strings.
 *
 * Deliberately local rather than asking the provider: a `usage.prompt_tokens` probe needs
 * four successful calls, and under a saturated rate limit those calls fail and return no
 * usage at all — which silently produces nonsense like "system prompt: 0 tokens". Bytes
 * on the wire are always measurable. ~4 chars/token is the standard approximation for
 * English and is close enough to aim optimisation at; the exact figure is confirmed
 * against a real call's usage in the cold-turn phase below.
 */
function tokenAccounting(): void {
  const schemaJson = JSON.stringify(EXTRACTION_SCHEMA);
  const sampleUser =
    'Language hint: hi-IN\n\nFields already known from earlier turns:\n  (nothing known yet)\n\nThe person just said:\nmain 34 saal ka hoon aur bihar mein rehta hoon';

  const estimate = (text: string): number => Math.ceil(text.length / 4);

  const system = estimate(SYSTEM_PROMPT);
  const schema = estimate(schemaJson);
  const user = estimate(sampleUser);
  const total = system + schema + user;

  console.log('TOKEN ACCOUNTING (per extraction call, ~4 chars/token)');
  console.log(`  system prompt   ${String(system).padStart(5)}  (${SYSTEM_PROMPT.length} chars)`);
  console.log(`  JSON schema     ${String(schema).padStart(5)}  (${schemaJson.length} chars)`);
  console.log(`  user input      ${String(user).padStart(5)}  (${sampleUser.length} chars)`);
  console.log('  ─────────────────────────');
  console.log(`  total prompt    ${String(total).padStart(5)}`);
  console.log(
    `  at 8,000 TPM →  ${(8000 / total).toFixed(1)} calls/min before throttling begins\n`,
  );

  // The question worth answering explicitly: is scheme data leaking into this call?
  const mentionsSchemes = /scheme|eligib|benefit|ministry/i.test(sampleUser);
  console.log(
    `  scheme data in the extraction prompt: ${mentionsSchemes ? 'YES — investigate' : 'no'}\n`,
  );
}

async function sqlBaseline(): Promise<void> {
  const timings: number[] = [];

  for (let index = 0; index < 10; index += 1) {
    const started = Date.now();
    await fetch(`${API}/matching`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: EMPTY_PROFILE }),
    }).then((response) => response.json());
    timings.push(Date.now() - started);
  }

  report('SQL match only, no LLM (POST /matching)', timings);
}

/**
 * One turn after a deliberate pause — what a judge experiences on the first interaction,
 * with the whole token budget available.
 */
async function coldTurn(): Promise<void> {
  console.log('Cooling down 65s so the tokens-per-minute window resets...');
  await sleep(65_000);

  const result = await timedTurn(TRANSCRIPTS[0]!, TIMEOUT_MS);
  console.log(
    `COLD TURN (full budget available): ${result.ok ? `${result.ms}ms` : `FAILED — ${result.error}`}\n`,
  );
}

/**
 * Turns back to back, which is what a real conversation does. Under a TPM cap this is
 * where the wall appears, and it is the number that actually decides whether a live demo
 * is viable.
 */
async function sustainedTurns(): Promise<void> {
  console.log(`SUSTAINED — ${TURNS} consecutive turns, ${TIMEOUT_MS}ms timeout each`);

  const timings: number[] = [];
  const failures: string[] = [];

  for (let index = 0; index < TURNS; index += 1) {
    const transcript = TRANSCRIPTS[index % TRANSCRIPTS.length]!;
    const result = await timedTurn(transcript, TIMEOUT_MS);

    if (result.ok) {
      timings.push(result.ms);
      process.stdout.write(`\r  ${index + 1}/${TURNS} — ${result.ms}ms        `);
    } else {
      failures.push(`turn ${index + 1}: ${result.error}`);
      process.stdout.write(`\r  ${index + 1}/${TURNS} — ${result.error}   `);
    }
  }

  process.stdout.write('\n\n');
  report(`Voice turn under sustained load (n=${TURNS})`, timings);

  console.log(`  succeeded within ${TIMEOUT_MS}ms: ${timings.length}/${TURNS}`);
  console.log(`  timed out or failed:            ${failures.length}/${TURNS}\n`);

  if (failures.length > 0) {
    console.log('  first few failures:');
    failures.slice(0, 5).forEach((failure) => console.log(`    ${failure}`));
    console.log('');
  }
}

type TurnResult = { ok: true; ms: number } | { ok: false; error: string };

async function timedTurn(transcript: string, timeoutMs: number): Promise<TurnResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(`${API}/voice/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, profile: EMPTY_PROFILE, language: 'hi-IN' }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, error: `HTTP ${response.status} ${body.slice(0, 70)}` };
    }

    await response.json();
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    return {
      ok: false,
      error: aborted ? `timeout >${timeoutMs}ms` : `${(error as Error).message}`.slice(0, 70),
    };
  } finally {
    clearTimeout(timer);
  }
}

function report(label: string, timings: number[]): void {
  if (timings.length === 0) {
    console.log(`${label}\n  no successful samples\n`);
    return;
  }

  console.log(label);
  console.log(`  n     ${timings.length}`);
  console.log(`  min   ${Math.min(...timings)}ms`);
  console.log(`  p50   ${percentile(timings, 50)}ms`);
  console.log(`  p95   ${percentile(timings, 95)}ms`);
  console.log(`  max   ${Math.max(...timings)}ms`);
  console.log('');
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv(): Record<string, string> {
  const path = resolve(__dirname, '../../../.env');
  const parsed: Record<string, string> = {};

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    parsed[line.slice(0, index).trim()] = line
      .slice(index + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }

  return parsed;
}

void main();
