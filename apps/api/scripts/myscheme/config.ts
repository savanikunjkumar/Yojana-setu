import { resolve } from 'node:path';

export interface ScrapeConfig {
  /** How many new schemes to land in the database before stopping. */
  target: number;
  /** Safety valve on discovery: the portal has ~478 pages of 10. */
  maxPages: number;
  /** Milliseconds to wait between page loads. Politeness, not throttling avoidance. */
  delayMs: number;
  /** Attempts per page before a URL is recorded as failed. */
  retries: number;
  normalizer: 'llm' | 'rules';
  /**
   * Income ceiling substituted when a scheme selects beneficiaries by SECC/BPL
   * deprivation criteria instead of a stated income cap. Matches the lower of the
   * two proxies used by seed.ts; every application is logged for review.
   */
  proxyIncomeCeiling: number;
  /** Scrape and normalise but write nothing. */
  dryRun: boolean;
  /**
   * Re-normalise the raw archive instead of visiting the portal. Combined with
   * `--force` this re-reads schemes already scraped — the way to upgrade rows
   * produced by the deterministic normaliser once an LLM key is available.
   */
  fromArchive: boolean;
  /** Ignore recorded progress and re-process every URL. */
  force: boolean;
  headless: boolean;
  stateFile: string;
  reportFile: string;
  rawArchiveFile: string;
  userAgent: string;
  llm: LlmConfig;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  /** Deterministic output matters more than variety when reading legal prose. */
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
}

// The package is CommonJS (no "type": "module"), so `__dirname` is the portable
// choice here — `import.meta` is not available under this module target.
const ARTIFACT_DIR = resolve(__dirname, '..', '.myscheme-data');

/**
 * Reads a flag as `--name=value` or `--name value`.
 *
 * The *last* occurrence wins, which is the conventional shell behaviour and the
 * behaviour npm scripts rely on: `npm run scrape:dry -- --target=6` appends to the
 * flags already baked into the script, so a caller's override arrives last and has
 * to take precedence.
 */
function flag(argv: string[], name: string): string | undefined {
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const arg = argv[index] ?? '';

    if (arg.startsWith(`--${name}=`)) {
      return arg.slice(name.length + 3);
    }

    if (arg === `--${name}`) {
      const next = argv[index + 1];
      return next && !next.startsWith('--') ? next : 'true';
    }
  }
  return undefined;
}

function number(argv: string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

function boolean(argv: string[], name: string, fallback: boolean): boolean {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  return raw !== 'false' && raw !== '0';
}

export function buildConfig(argv: string[] = process.argv.slice(2)): ScrapeConfig {
  const normalizer = flag(argv, 'normalizer') ?? 'llm';
  if (normalizer !== 'llm' && normalizer !== 'rules') {
    throw new Error(`--normalizer must be "llm" or "rules", got "${normalizer}"`);
  }

  return {
    target: number(argv, 'target', 175),
    maxPages: number(argv, 'max-pages', 60),
    delayMs: number(argv, 'delay', 1500),
    retries: number(argv, 'retries', 2),
    normalizer,
    proxyIncomeCeiling: number(argv, 'proxy-income', 100_000),
    dryRun: boolean(argv, 'dry-run', false),
    fromArchive: boolean(argv, 'from-archive', false),
    force: boolean(argv, 'force', false),
    headless: boolean(argv, 'headless', true),
    stateFile: flag(argv, 'state-file') ?? resolve(ARTIFACT_DIR, 'progress.jsonl'),
    reportFile: flag(argv, 'report-file') ?? resolve(ARTIFACT_DIR, 'report.md'),
    rawArchiveFile: flag(argv, 'raw-file') ?? resolve(ARTIFACT_DIR, 'raw-schemes.jsonl'),
    // Identifies the crawler and gives the portal's operators a way to reach us,
    // which is the least a project scraping a government service should do.
    userAgent:
      flag(argv, 'user-agent') ??
      'YojanaSetuBot/0.1 (Smart India Hackathon 2026 project; +https://www.myscheme.gov.in/)',
    llm: {
      baseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      apiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY,
      model: flag(argv, 'llm-model') ?? process.env.LLM_MODEL ?? 'gpt-4o-mini',
      temperature: 0,
      timeoutMs: number(argv, 'llm-timeout', 60_000),
      maxRetries: number(argv, 'llm-retries', 2),
    },
  };
}

export const ARTIFACT_DIRECTORY = ARTIFACT_DIR;
export const MYSCHEME_ORIGIN = 'https://www.myscheme.gov.in';
export const SEARCH_URL = `${MYSCHEME_ORIGIN}/search`;
