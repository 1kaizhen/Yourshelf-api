// Community wrapper around HowLongToBeat's web data. No official API,
// so treat every call as best-effort and cache aggressively.
// @ts-ignore - the library ships without good types
import pkg from 'howlongtobeat';
const { HowLongToBeatService } = pkg as { HowLongToBeatService: new () => HltbService };

interface HltbEntry {
  id: string;
  name: string;
  gameplayMain: number;
  gameplayMainExtra: number;
  gameplayCompletionist: number;
  similarity: number;
}
interface HltbService {
  search(query: string): Promise<HltbEntry[]>;
}

export type HltbTimes = {
  main: number | null;
  mainExtra: number | null;
  completionist: number | null;
};

const service: HltbService = new HowLongToBeatService();

type CacheEntry = { value: HltbTimes; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const EMPTY: HltbTimes = { main: null, mainExtra: null, completionist: null };

export async function getHltbTimes(name: string): Promise<HltbTimes> {
  const key = name.trim().toLowerCase();
  if (!key) return EMPTY;

  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    const results = await service.search(name);
    if (!results.length) {
      cache.set(key, { value: EMPTY, expiresAt: Date.now() + TTL_MS });
      return EMPTY;
    }
    const best = results.sort((a, b) => b.similarity - a.similarity)[0];
    const value: HltbTimes = {
      main: best.gameplayMain || null,
      mainExtra: best.gameplayMainExtra || null,
      completionist: best.gameplayCompletionist || null,
    };
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    console.warn(`HLTB lookup failed for "${name}":`, (err as Error).message);
    // Negative-cache briefly so a flaky scraper doesn't hammer the upstream.
    cache.set(key, { value: EMPTY, expiresAt: Date.now() + 60 * 60 * 1000 });
    return EMPTY;
  }
}
