import type {
  ApplicantProfile,
  ApplicationPack,
  MatchResponse,
  SchemeStats,
  VoiceTurnResult,
} from '@sih/shared';
import { DEMO_PERSONAS } from '@sih/shared';
import snapshot from './demo-snapshot.json';

/**
 * Offline demo mode.
 *
 * Serves a recorded end-to-end path — transcript, profile, matches, application pack — with
 * no network and no API calls, for the venue where the wifi fails at the worst moment. The
 * recording is genuine: real matches from the real scraped schemes, produced by the real SQL
 * matcher and captured by `capture-demo-snapshot.ts`. Nothing here is invented, so what a
 * judge sees offline is a true query result that simply happened earlier.
 *
 * Enabled with `NEXT_PUBLIC_DEMO_OFFLINE=1`. It is read at module scope because Next inlines
 * `NEXT_PUBLIC_*` at build time, so this is a build-level switch rather than a runtime one.
 */
export const OFFLINE_MODE = process.env.NEXT_PUBLIC_DEMO_OFFLINE === '1';

interface PersonaSnapshot {
  personaId: string;
  transcript: string;
  match: MatchResponse;
  pack: ApplicationPack | null;
  packSchemeId: string | null;
}

interface Snapshot {
  capturedAt: string;
  schemeCount: number;
  stats: SchemeStats;
  personas: PersonaSnapshot[];
}

const data = snapshot as unknown as Snapshot;

export const SNAPSHOT_INFO = {
  capturedAt: data.capturedAt,
  schemeCount: data.schemeCount,
  personaCount: data.personas.length,
};

/**
 * Finds the recorded path closest to a given profile.
 *
 * Matches on state and age band rather than requiring an exact profile, so a presenter who
 * tweaks one field in the form still gets a sensible recorded answer instead of an empty
 * screen — which would defeat the point of a fallback.
 */
function bestPersonaFor(profile: ApplicantProfile): PersonaSnapshot {
  const scored = data.personas.map((entry) => {
    const persona = DEMO_PERSONAS.find((candidate) => candidate.id === entry.personaId);
    if (!persona) return { entry, score: 0 };

    let score = 0;
    if (persona.profile.state === profile.state) score += 3;
    if (persona.profile.occupation === profile.occupation) score += 2;
    if (persona.profile.isStudent === profile.isStudent) score += 1;
    if (
      profile.age !== null &&
      persona.profile.age !== null &&
      Math.abs(persona.profile.age - profile.age) <= 8
    ) {
      score += 2;
    }
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.entry ?? data.personas[0]!;
}

export function offlineMatch(profile: ApplicantProfile): MatchResponse {
  const chosen = bestPersonaFor(profile);

  // An all-null profile is the page's initial state; returning the recorded nextQuestion
  // keeps the conversational loop demonstrable offline.
  return chosen.match;
}

export function offlineVoiceTurn(profile: ApplicantProfile): VoiceTurnResult {
  const chosen = bestPersonaFor(profile);
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === chosen.personaId);
  const merged = persona?.profile ?? profile;

  const filledFields = (Object.keys(merged) as Array<keyof ApplicantProfile>).filter(
    (field) => profile[field] === null && merged[field] !== null,
  );

  return {
    profile: merged,
    filledFields,
    unstatedFields: [],
    match: chosen.match,
    reasoning: 'Recorded demo response — offline mode is on, so nothing was sent to a model.',
    statusSummary: null,
  };
}

export function offlineTranscript(personaId?: string): string {
  const chosen = personaId
    ? data.personas.find((entry) => entry.personaId === personaId)
    : data.personas[0];
  return chosen?.transcript ?? data.personas[0]!.transcript;
}

/**
 * Recorded application pack. Falls back to any recorded pack when the requested scheme was
 * not the one captured, so "Help me apply" always shows something rather than an error.
 */
export function offlinePack(schemeId: string, profile: ApplicantProfile): ApplicationPack {
  const exact = data.personas.find((entry) => entry.packSchemeId === schemeId)?.pack;
  if (exact) return exact;

  const nearest = bestPersonaFor(profile).pack;
  if (nearest) return nearest;

  const anyPack = data.personas.find((entry) => entry.pack)?.pack;
  if (!anyPack) {
    throw new Error('No application pack was captured in the demo snapshot');
  }
  return anyPack;
}

/**
 * Recorded corpus statistics.
 *
 * The stats page is the one screen whose whole point is that the numbers are real, so it
 * would be self-defeating to invent them when the network drops. These are the figures the
 * live endpoint returned at capture time.
 */
export function offlineStats(): SchemeStats {
  return data.stats;
}
