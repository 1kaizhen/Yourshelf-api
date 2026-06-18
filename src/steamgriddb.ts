import { env } from './env.js';
import { createCache } from './cache.js';

const API = 'https://www.steamgriddb.com/api/v2';
const TTL = 60 * 60 * 1000; // 1 hour
const idCache = createCache<number | null>(TTL);
const assetCache = createCache<SgdbAsset[]>(TTL);

export type SgdbAsset = {
  id: number;
  url: string;
  thumb?: string;
  width?: number;
  height?: number;
  style?: string;       // logos: official | white | black | custom
  mime?: string;
};

type SgdbSearchHit = { id: number; name: string; release_date?: number };

async function request<T>(path: string): Promise<T | null> {
  if (!env.STEAMGRIDDB_API_KEY) return null;
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${env.STEAMGRIDDB_API_KEY}` },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`SGDB ${path} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { success: boolean; data: T };
  if (!body.success) return null;
  return body.data;
}

// Find the SGDB game id for a name. Prefer the closest case-insensitive match.
export async function findGameId(name: string): Promise<number | null> {
  if (!env.STEAMGRIDDB_API_KEY || !name) return null;
  return idCache.get(`name:${name.toLowerCase()}`, async () => {
    const term = encodeURIComponent(name);
    const data = await request<SgdbSearchHit[]>(`/search/autocomplete/${term}`);
    if (!data || data.length === 0) return null;
    const normalized = name.trim().toLowerCase();
    const exact = data.find((h) => h.name.trim().toLowerCase() === normalized);
    return (exact ?? data[0]).id;
  });
}

type GetLogosOpts = { styles?: Array<'official' | 'white' | 'black' | 'custom'> };
type GetGridsOpts = { dimensions?: string[] };

export async function getLogos(sgdbId: number, opts: GetLogosOpts = {}): Promise<SgdbAsset[]> {
  const styles = opts.styles && opts.styles.length ? `?styles=${opts.styles.join(',')}` : '';
  return (await assetCache.get(`logos:${sgdbId}:${styles}`, async () => {
    const data = await request<SgdbAsset[]>(`/logos/game/${sgdbId}${styles}`);
    return data ?? [];
  })) as SgdbAsset[];
}

export async function getHeroes(sgdbId: number): Promise<SgdbAsset[]> {
  return (await assetCache.get(`heroes:${sgdbId}`, async () => {
    const data = await request<SgdbAsset[]>(`/heroes/game/${sgdbId}`);
    return data ?? [];
  })) as SgdbAsset[];
}

export async function getGrids(sgdbId: number, opts: GetGridsOpts = {}): Promise<SgdbAsset[]> {
  const dims = opts.dimensions && opts.dimensions.length ? `?dimensions=${opts.dimensions.join(',')}` : '';
  return (await assetCache.get(`grids:${sgdbId}:${dims}`, async () => {
    const data = await request<SgdbAsset[]>(`/grids/game/${sgdbId}${dims}`);
    return data ?? [];
  })) as SgdbAsset[];
}

// One-shot helper: get the best (logo, hero, cover) trio for a game name.
export type SgdbBundle = {
  sgdbId: number | null;
  logo: string | null;
  hero: string | null;
  cover: string | null;
};

export async function getBundleByName(name: string): Promise<SgdbBundle> {
  const sgdbId = await findGameId(name);
  if (!sgdbId) return { sgdbId: null, logo: null, hero: null, cover: null };

  const [logos, heroes, grids] = await Promise.all([
    // Prefer official → white → custom (most legible variants).
    getLogos(sgdbId, { styles: ['official', 'white', 'custom'] }),
    getHeroes(sgdbId),
    getGrids(sgdbId, { dimensions: ['600x900', '460x215'] }),
  ]);

  // Pick the widest hero (most cinematic), the first official-or-white logo,
  // and the first 600x900 portrait grid; fall back to anything available.
  const hero = pickWidest(heroes);
  const logo = pickPreferredLogo(logos);
  const cover = pickPortrait(grids);

  return { sgdbId, logo, hero, cover };
}

function pickWidest(assets: SgdbAsset[]): string | null {
  if (!assets.length) return null;
  const sorted = [...assets].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url ?? null;
}

function pickPreferredLogo(assets: SgdbAsset[]): string | null {
  if (!assets.length) return null;
  const order = ['official', 'white', 'custom', 'black'];
  for (const style of order) {
    const hit = assets.find((a) => a.style === style);
    if (hit) return hit.url;
  }
  return assets[0]?.url ?? null;
}

function pickPortrait(assets: SgdbAsset[]): string | null {
  if (!assets.length) return null;
  const portrait = assets.find(
    (a) => (a.width ?? 0) > 0 && (a.height ?? 0) > 0 && (a.height ?? 0) > (a.width ?? 0)
  );
  return (portrait ?? assets[0])?.url ?? null;
}
