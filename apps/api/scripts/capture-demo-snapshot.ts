/**
 * Captures a complete end-to-end demo path from the LIVE system into a JSON fixture, so the
 * whole demo can run with no network and no API calls.
 *
 *   npx tsx scripts/capture-demo-snapshot.ts
 *
 * The recorded responses are real: actual matches from the actual scraped schemes, produced
 * by the actual SQL matcher. That matters for two reasons. Hand-written fixtures drift from
 * the system they claim to represent, and — more importantly — demoing invented results
 * while implying they are real would be dishonest. If the wifi dies mid-demo, what the
 * judges see is still a genuine query result, just a recorded one.
 *
 * Re-run this whenever the scheme data changes materially.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  DEMO_PERSONAS,
  type ApplicationPack,
  type MatchResponse,
  type SchemeStats,
} from '@sih/shared';

const API = process.env.CAPTURE_API_URL ?? 'http://localhost:4000/api';
const OUTPUT = resolve(__dirname, '../../web/src/lib/demo-snapshot.json');

interface PersonaSnapshot {
  personaId: string;
  /** What the voice layer would have transcribed, recorded so STT can be skipped offline. */
  transcript: string;
  match: MatchResponse;
  /** Application pack for the most interesting scheme in the result set. */
  pack: ApplicationPack | null;
  packSchemeId: string | null;
}

interface Snapshot {
  capturedAt: string;
  schemeCount: number;
  /** The corpus statistics page, so it survives a dead network like everything else. */
  stats: SchemeStats;
  personas: PersonaSnapshot[];
}

async function main(): Promise<void> {
  const health = await get<{ schemes: number }>('/health');
  console.log(`Capturing against ${API} — ${health.schemes} schemes loaded\n`);

  const stats = await get<SchemeStats>('/schemes/stats');

  const personas: PersonaSnapshot[] = [];

  for (const persona of DEMO_PERSONAS) {
    const match = await post<MatchResponse>('/matching', {
      profile: persona.profile,
      // Near misses included so the recorded path can also show the "you just miss out" case.
      maxFailures: 1,
      limit: 12,
    });

    // Prefer a PROXY scheme for the pack: it is the one that needs the confidence
    // distinction on screen, and the reason the widow persona exists.
    const proxyMatch = match.matches.find((scheme) => scheme.proxyNote);
    const target = proxyMatch ?? match.matches.find((scheme) => scheme.isEligible) ?? match.matches[0];

    let pack: ApplicationPack | null = null;
    if (target) {
      pack = await post<ApplicationPack>('/assistance/pack', {
        schemeId: target.id,
        profile: persona.profile,
      });
    }

    personas.push({
      personaId: persona.id,
      transcript: persona.spokenIntro,
      match,
      pack,
      packSchemeId: target?.id ?? null,
    });

    console.log(
      `  ${persona.name.padEnd(14)} ${match.eligibleCount} eligible, ${match.matches.length} shown` +
        `${proxyMatch ? ` — pack uses a PROXY scheme (${proxyMatch.name.slice(0, 40)})` : ''}`,
    );
  }

  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    schemeCount: health.schemes,
    stats,
    personas,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  const sizeKb = Math.round(JSON.stringify(snapshot).length / 1024);
  console.log(`\nWrote ${OUTPUT.split('/apps/')[1]} (${sizeKb} KB)`);

  const withProxy = personas.filter((persona) => persona.pack?.proxyWarning).length;
  console.log(
    withProxy > 0
      ? `${withProxy} persona(s) carry a PROXY pack, so the approximate-match distinction is demoable offline.`
      : 'WARNING: no persona produced a PROXY pack — the approximate-match demo will have nothing to show.',
  );
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`GET ${path} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} → HTTP ${response.status} ${(await response.text()).slice(0, 150)}`);
  }
  return (await response.json()) as T;
}

main().catch((error) => {
  console.error('\nCapture failed:', error.message);
  console.error('Is the API running? `npm run dev` or `npm run demo:ready`.');
  process.exitCode = 1;
});
