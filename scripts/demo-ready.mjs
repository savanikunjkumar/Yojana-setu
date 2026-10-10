#!/usr/bin/env node
/**
 * One command to run in the venue: brings the stack up from cold and reports what is
 * missing.
 *
 *   npm run demo:ready
 *   npm run demo:ready -- --skip-llm     # when the wifi is hostile
 *
 * Written because this machine has already lost a scrape run and its Postgres container to
 * a reboot, and Playwright's browsers to a ~/.cache clear. Each of those failed silently
 * until something downstream broke, so every check here reports the remediation command
 * rather than just a red cross — the point is to be usable while standing at a table with
 * judges waiting.
 *
 * Exit code is 0 only when everything the demo needs is present. Non-essential gaps (a
 * short scrape, no Sarvam key) warn without failing, because the demo still runs without them.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_LLM = process.argv.includes('--skip-llm');

const results = [];
let hardFailure = false;

function record(name, state, detail, remedy) {
  results.push({ name, state, detail, remedy });
  if (state === 'fail') hardFailure = true;

  const icon = { pass: '  ok  ', warn: ' warn ', fail: ' FAIL ' }[state];
  console.log(`${icon} ${name}`);
  if (detail) console.log(`        ${detail}`);
  if (remedy && state !== 'pass') console.log(`        → ${remedy}`);
}

function env() {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return null;

  const parsed = {};
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

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    ...options,
  });
}

/**
 * Runs SQL inside the Postgres container.
 *
 * Deliberately not `psql "$DATABASE_URL"` on the host: that requires a host psql binary
 * that may not exist on a teammate's laptop, and it puts the database password on a command
 * line where any other process can read it out of `ps`. Inside the container the connection
 * is local and trusted, so neither problem arises.
 */
function sql(config, statement, options = {}) {
  return run(
    'node',
    [
      'scripts/compose.mjs',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      config.POSTGRES_USER ?? 'sih',
      '-d',
      config.POSTGRES_DB ?? 'sih_schemes',
      '-X',
      '-t',
      '-A',
      '-c',
      statement,
    ],
    options,
  );
}

/** Waits for Postgres to accept connections rather than assuming `up` means ready. */
async function waitForPostgres(config, attempts = 30) {
  let lastError = '';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const probe = sql(config, 'SELECT 1', { timeout: 8_000 });
    if (probe.status === 0) return { ready: true };

    lastError = (probe.stderr || probe.error?.message || '').trim().split('\n').pop() ?? '';
    await new Promise((done) => setTimeout(done, 1000));
  }

  return { ready: false, reason: lastError };
}

async function main() {
  console.log('\nDemo readiness check\n' + '─'.repeat(58));

  // 1 — configuration
  const config = env();
  if (!config) {
    record('.env present', 'fail', 'No .env at the repo root', 'npm run setup');
    return finish();
  }
  record('.env present', 'pass', `DATABASE_URL → ${config.DATABASE_URL?.split('@')[1] ?? '?'}`);

  // 2 — container engine and database
  const up = run('node', ['scripts/compose.mjs', 'up', '-d', 'postgres']);
  if (up.status !== 0) {
    record(
      'Postgres container',
      'fail',
      (up.stderr || up.stdout || '').trim().split('\n').slice(-2).join(' '),
      'Start an engine: systemctl --user enable --now podman.socket   (or sudo systemctl start docker)',
    );
  } else {
    const { ready, reason } = await waitForPostgres(config);
    record(
      'Postgres container',
      ready ? 'pass' : 'fail',
      ready ? 'accepting connections' : `not accepting connections — ${reason || 'no response'}`,
      ready ? undefined : 'npm run db:logs',
    );
  }

  if (hardFailure) return finish();

  // 3 — migrations. Checks for the matcher function specifically: `prisma db push` leaves
  // the tables in place but not the SQL function, which fails only at match time.
  const objects = sql(
    config,
    `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('schemes','applicants','applications'))
       || '/' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='match_schemes')
       || '/' || (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL)`,
  );

  const [tables, matcher, migrations] = (objects.stdout ?? '').trim().split('/').map(Number);

  if (tables === 3 && matcher === 1) {
    record('Schema and matcher', 'pass', `3 tables, match_schemes() present, ${migrations} migrations applied`);
  } else {
    record(
      'Schema and matcher',
      'fail',
      `tables=${tables ?? 0}/3, match_schemes=${matcher ?? 0}/1`,
      'npm run db:deploy',
    );
  }

  // 4 — the matcher actually answers
  const assertions = run('node', [
    'scripts/compose.mjs',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    config.POSTGRES_USER ?? 'sih',
    '-d',
    config.POSTGRES_DB ?? 'sih_schemes',
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-o',
    '/dev/null',
    '-f',
    '/dev/stdin',
  ], { input: readFileSync(resolve(ROOT, 'apps/api/prisma/sql/verify-matching.sql'), 'utf8') });

  const passed = (assertions.stderr ?? '').match(/NOTICE:\s+ok/g)?.length ?? 0;
  record(
    'Matcher assertions',
    passed >= 52 ? 'pass' : 'fail',
    `${passed}/52 expectations passed`,
    passed >= 52 ? undefined : 'npm run db:verify   (see the failing expectation)',
  );

  // 5 — data. A short scrape only weakens the demo, so it warns.
  const counts = sql(
    config,
    `SELECT count(*) || '/' || count(*) FILTER (WHERE state IS NULL) || '/' || count(*) FILTER (WHERE proxy_note IS NOT NULL) FROM schemes`,
  );
  const [total, central, proxy] = (counts.stdout ?? '').trim().split('/').map(Number);

  if (!total) {
    record('Scheme data', 'fail', 'No schemes loaded', 'npm run db:seed');
  } else if (total < 50) {
    record('Scheme data', 'warn', `only ${total} schemes`, 'npm run db:seed && npm run scrape');
  } else {
    record(
      'Scheme data',
      'pass',
      `${total} schemes (${central} central, ${total - central} state), ${proxy} PROXY-flagged`,
    );
  }

  record(
    'Demo personas',
    proxy > 0 ? 'pass' : 'warn',
    proxy > 0
      ? 'a PROXY match exists, so the approximate-match distinction is demonstrable'
      : 'no PROXY schemes loaded — that part of the demo will have nothing to show',
    proxy > 0 ? undefined : 'npm run scrape -- --target=40',
  );

  // 6 — LLM. Optional: offline mode covers its absence.
  if (SKIP_LLM) {
    record('LLM reachable', 'warn', 'skipped by --skip-llm; offline mode will serve the demo');
  } else if (!config.LLM_API_KEY) {
    record(
      'LLM reachable',
      'warn',
      'LLM_API_KEY not set — voice extraction will be unavailable',
      'Set LLM_API_KEY, or demo with NEXT_PUBLIC_DEMO_OFFLINE=1',
    );
  } else {
    const model = config.VOICE_LLM_MODEL || config.LLM_MODEL;
    const started = Date.now();
    try {
      const response = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const ms = Date.now() - started;

      if (response.ok) {
        record('LLM reachable', 'pass', `${model} answered in ${ms}ms`);
      } else {
        record(
          'LLM reachable',
          'warn',
          `${model} returned HTTP ${response.status}`,
          'Demo with NEXT_PUBLIC_DEMO_OFFLINE=1 if this persists',
        );
      }
    } catch (error) {
      record(
        'LLM reachable',
        'warn',
        `could not reach ${config.LLM_BASE_URL}: ${error.message}`,
        'Venue wifi? Run the demo with NEXT_PUBLIC_DEMO_OFFLINE=1',
      );
    }
  }

  // 7 — Playwright browsers, wiped from ~/.cache more than once on this machine. Only the
  // scraper needs them, so their absence never blocks a demo.
  //
  // `--dry-run` reports where each browser *would* live, whether or not it is actually
  // there, so scanning its prose for "not found" always passed. It also passed while the
  // cache held chromium-1228 and this Playwright wanted 1234 — a version mismatch fails
  // exactly like a missing browser, and reporting it green is worse than not checking. So
  // the install locations are parsed out and stat-ed on disk.
  const browsers = run('npx', ['playwright', 'install', '--dry-run', 'chromium'], {
    timeout: 30_000,
  });
  const locations = [...(browsers.stdout ?? '').matchAll(/Install location:\s*(\S+)/g)]
    .map((match) => match[1])
    // ffmpeg is for video capture, which the scraper never uses.
    .filter((path) => !path.includes('ffmpeg'));
  const absent = locations.filter((path) => !existsSync(path));

  if (locations.length === 0) {
    record(
      'Playwright browser (scraper only)',
      'warn',
      'could not determine the browser location',
      'npx playwright install chromium',
    );
  } else {
    record(
      'Playwright browser (scraper only)',
      absent.length ? 'warn' : 'pass',
      absent.length
        ? `${absent.length} of ${locations.length} missing (${absent
            .map((path) => path.split('/').pop())
            .join(', ')}) — scraping unavailable, demo unaffected`
        : `present (${locations.length} verified on disk)`,
      absent.length ? 'npx playwright install chromium' : undefined,
    );
  }

  finish();
}

function finish() {
  const warns = results.filter((result) => result.state === 'warn').length;
  const fails = results.filter((result) => result.state === 'fail').length;

  console.log('─'.repeat(58));

  if (fails > 0) {
    console.log(`\nNOT READY — ${fails} blocking issue${fails === 1 ? '' : 's'}. Fix the → lines above.\n`);
    process.exit(1);
  }

  console.log(
    `\nREADY${warns > 0 ? ` — with ${warns} warning${warns === 1 ? '' : 's'} (demo still runs)` : ''}\n`,
  );
  // Read from .env rather than hardcoded: the ports are configurable, and a readiness
  // check that confidently prints the wrong URL is worse than one that prints none.
  const { WEB_PORT = '3000', API_PORT = '4000' } = env();

  console.log('  Start it:  npm run dev');
  console.log(`  Web:       http://localhost:${WEB_PORT}`);
  console.log(`  API docs:  http://localhost:${API_PORT}/api/docs`);
  console.log('  Offline:   NEXT_PUBLIC_DEMO_OFFLINE=1 npm run dev\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('\nReadiness check crashed:', error.message);
  process.exit(1);
});
