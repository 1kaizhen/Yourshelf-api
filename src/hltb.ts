// Game play-time data via IGDB's game_time_to_beats endpoint.
// IGDB sources this from HowLongToBeat. Times are returned in seconds; we expose hours.
// Way more reliable than scraping HLTB directly (which the howlongtobeat npm pkg currently fails to do).
import { igdbRequest } from './igdb.js';

export type HltbTimes = {
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
};

const EMPTY: HltbTimes = { main: null, mainExtra: null, completionist: null };

type IgdbTimeToBeats = {
  id: number;
  game_id: number;
  hastily?: number;
  normally?: number;
  completely?: number;
  count?: number;
};

type CacheEntry = { value: HltbTimes; expiresAt: number };
const cacheByGameId = new Map<number, CacheEntry>();
const cacheByName = new Map<string, CacheEntry>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toHours(seconds: number | undefined): number | null {
  if (!seconds || seconds <= 0) return null;
  return Math.round((seconds / 3600) * 10) / 10;
}

function rowToTimes(row: IgdbTimeToBeats | undefined): HltbTimes {
  if (!row) return EMPTY;
  return {
    main: toHours(row.normally),
    mainExtra: toHours(row.hastily) ?? toHours(row.normally),
    completionist: toHours(row.completely),
  };
}

/** Bulk lookup — one IGDB call for many ids. Returns map keyed by game id. */
export async function getHltbByGameIds(gameIds: number[]): Promise<Map<number, HltbTimes>> {
  const result = new Map<number, HltbTimes>();
  const toFetch: number[] = [];
  const now = Date.now();

  for (const id of gameIds) {
    const hit = cacheByGameId.get(id);
    if (hit && hit.expiresAt > now) result.set(id, hit.value);
    else toFetch.push(id);
  }

  if (toFetch.length === 0) return result;

  // IGDB allows large `where ... = (...)` lists. Cap at 500 per request.
  const CHUNK = 500;
  for (let i = 0; i < toFetch.length; i += CHUNK) {
    const chunk = toFetch.slice(i, i + CHUNK);
    try {
      const rows = await igdbRequest<IgdbTimeToBeats[]>(
        'game_time_to_beats',
        `fields hastily,normally,completely,count,game_id; where game_id = (${chunk.join(',')}); limit ${chunk.length};`
      );
      const byId = new Map(rows.map((r) => [r.game_id, r]));
      for (const id of chunk) {
        const value = rowToTimes(byId.get(id));
        cacheByGameId.set(id, { value, expiresAt: now + TTL_MS });
        result.set(id, value);
      }
    } catch (err) {
      console.warn(`bulk game_time_to_beats failed for ${chunk.length} ids:`, (err as Error).message);
      for (const id of chunk) {
        cacheByGameId.set(id, { value: EMPTY, expiresAt: now + 60 * 60 * 1000 });
        result.set(id, EMPTY);
      }
    }
  }
  return result;
}

/** Direct lookup by IGDB game id — preferred when available. */
export async function getHltbByGameId(gameId: number): Promise<HltbTimes> {
  const hit = cacheByGameId.get(gameId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    const rows = await igdbRequest<IgdbTimeToBeats[]>(
      'game_time_to_beats',
      `fields hastily,normally,completely,count,game_id; where game_id = ${gameId}; limit 1;`
    );
    const value = rowToTimes(rows[0]);
    cacheByGameId.set(gameId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    console.warn(`game_time_to_beats failed for game_id=${gameId}:`, (err as Error).message);
    cacheByGameId.set(gameId, { value: EMPTY, expiresAt: Date.now() + 60 * 60 * 1000 });
    return EMPTY;
  }
}

/** Name-based lookup, kept for the old discover flow that only has names handy. */
export async function getHltbTimes(name: string): Promise<HltbTimes> {
  const key = name.trim().toLowerCase();
  if (!key) return EMPTY;

  const hit = cacheByName.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    const games = await igdbRequest<{ id: number }[]>(
      'games',
      `fields id; search "${name.replace(/"/g, '')}"; limit 1;`
    );
    if (!games[0]) {
      cacheByName.set(key, { value: EMPTY, expiresAt: Date.now() + TTL_MS });
      return EMPTY;
    }
    const value = await getHltbByGameId(games[0].id);
    cacheByName.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    console.warn(`HLTB lookup failed for "${name}":`, (err as Error).message);
    cacheByName.set(key, { value: EMPTY, expiresAt: Date.now() + 60 * 60 * 1000 });
    return EMPTY;
  }
}
