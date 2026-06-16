import { env } from './env.js';
import { igdbRequest } from './igdb.js';
import { supabaseAdmin } from './supabase.js';
import { getHltbTimes, getHltbByGameIds, type HltbTimes } from './hltb.js';
import { createCache } from './cache.js';

const ONE_HOUR = 60 * 60 * 1000;
const discoverCache = createCache<unknown>(ONE_HOUR);
// Short TTL so new ratings appear quickly. Aggregation is cheap (Supabase + maybe
// one bulk IGDB call), so we don't need long-lived caching here.
const peoplesChoiceCache = createCache<unknown>(60 * 1000);

type IgdbCover = { image_id: string };
type IgdbCompanyLink = {
  developer?: boolean;
  publisher?: boolean;
  company?: { id: number; name: string };
};
type IgdbNamed = { id: number; name: string; slug?: string; cover?: IgdbCover; first_release_date?: number };

type IgdbGameLite = {
  id: number;
  name: string;
  slug: string;
  cover?: IgdbCover;
  first_release_date?: number;
};

type IgdbGameFull = IgdbGameLite & {
  summary?: string;
  total_rating?: number;
  total_rating_count?: number;
  genres?: { id: number; name: string }[];
  involved_companies?: IgdbCompanyLink[];
  dlcs?: IgdbNamed[];
  expansions?: IgdbNamed[];
  remakes?: IgdbNamed[];
  remasters?: IgdbNamed[];
  franchise?: { id: number; name: string };
  collection?: { id: number; name: string };
};

export type GameLite = {
  igdb_id: number;
  name: string;
  slug: string;
  cover_url: string | null;
  year: number | null;
};

export type GameRelation = { igdb_id: number; name: string };
export type Company = { id: number; name: string };

export type GameDetail = GameLite & {
  summary: string | null;
  release_date: string | null;
  rating: number | null;
  rating_count: number | null;
  genres: string[];
  developers: Company[];
  publishers: Company[];
  dlcs: GameRelation[];
  expansions: GameRelation[];
  remakes: GameRelation[];
  remasters: GameRelation[];
  franchise_id: number | null;
  collection_id: number | null;
  hltb: HltbTimes;
  updated_at: string;
};

const TTL_MS = env.GAMES_CACHE_TTL_HOURS * 60 * 60 * 1000;

const FIELDS_LITE = 'fields id,name,slug,cover.image_id,first_release_date;';
const FIELDS_FULL =
  'fields id,name,slug,summary,first_release_date,total_rating,total_rating_count,' +
  'cover.image_id,genres.name,' +
  'involved_companies.developer,involved_companies.publisher,involved_companies.company.id,involved_companies.company.name,' +
  'dlcs.id,dlcs.name,expansions.id,expansions.name,remakes.id,remakes.name,remasters.id,remasters.name,' +
  'franchise,collection;';

function coverUrl(imageId: string | undefined, size = 't_cover_big'): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
}

function yearOf(unix?: number): number | null {
  return unix ? new Date(unix * 1000).getUTCFullYear() : null;
}

function mapLite(g: IgdbGameLite): GameLite {
  return {
    igdb_id: g.id,
    name: g.name,
    slug: g.slug,
    cover_url: coverUrl(g.cover?.image_id),
    year: yearOf(g.first_release_date),
  };
}

function mapRelations(items: IgdbNamed[] | undefined): GameRelation[] {
  return (items ?? []).map((i) => ({ igdb_id: i.id, name: i.name }));
}

function mapCompanies(links: IgdbCompanyLink[] | undefined): { developers: Company[]; publishers: Company[] } {
  const developers: Company[] = [];
  const publishers: Company[] = [];
  for (const link of links ?? []) {
    if (!link.company) continue;
    const c: Company = { id: link.company.id, name: link.company.name };
    if (link.developer) developers.push(c);
    if (link.publisher) publishers.push(c);
  }
  return { developers, publishers };
}

function mapFullToRow(g: IgdbGameFull, hltb: HltbTimes) {
  const { developers, publishers } = mapCompanies(g.involved_companies);
  return {
    igdb_id: g.id,
    name: g.name,
    slug: g.slug,
    summary: g.summary ?? null,
    release_date: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString() : null,
    cover_url: coverUrl(g.cover?.image_id),
    year: yearOf(g.first_release_date),
    rating: g.total_rating ?? null,
    rating_count: g.total_rating_count ?? null,
    genres: (g.genres ?? []).map((x) => x.name),
    developers,
    publishers,
    dlcs: mapRelations(g.dlcs),
    expansions: mapRelations(g.expansions),
    remakes: mapRelations(g.remakes),
    remasters: mapRelations(g.remasters),
    franchise_id: g.franchise?.id ?? null,
    collection_id: g.collection?.id ?? null,
    hltb,
    updated_at: new Date().toISOString(),
  };
}

function passesHltb(filters: DiscoverFilters) {
  return ({ hltb }: { hltb: HltbTimes }) => {
    if (hltb.main === null || hltb.main === undefined) return false;
    if (filters.maxHours !== undefined && hltb.main > filters.maxHours) return false;
    if (filters.minHours !== undefined && hltb.main < filters.minHours) return false;
    return true;
  };
}

function isFresh(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < TTL_MS;
}

export async function searchGames(query: string, limit = 20): Promise<GameLite[]> {
  const sanitized = query.replace(/"/g, '').slice(0, 100);
  const results = await igdbRequest<IgdbGameLite[]>(
    'games',
    `${FIELDS_LITE} search "${sanitized}"; limit ${limit};`
  );
  return results.map(mapLite);
}

export async function getGameDetail(igdbId: number): Promise<GameDetail | null> {
  const { data: cached } = await supabaseAdmin
    .from('games')
    .select('*')
    .eq('igdb_id', igdbId)
    .maybeSingle();

  if (cached && isFresh(cached.updated_at)) return cached as GameDetail;

  const results = await igdbRequest<IgdbGameFull[]>('games', `${FIELDS_FULL} where id = ${igdbId};`);
  const fresh = results[0];
  if (!fresh) return (cached as GameDetail) ?? null;

  const hltb = await getHltbTimes(fresh.name);
  const row = mapFullToRow(fresh, hltb);

  const { data: upserted } = await supabaseAdmin
    .from('games')
    .upsert(row, { onConflict: 'igdb_id' })
    .select()
    .single();

  return (upserted as GameDetail) ?? (row as GameDetail);
}

export async function getGameSeries(igdbId: number): Promise<GameLite[]> {
  const detail = await getGameDetail(igdbId);
  if (!detail) return [];

  const ids = [detail.franchise_id, detail.collection_id].filter((x): x is number => x !== null);
  if (ids.length === 0) return [];

  // IGDB exposes franchise membership via games.franchises (array) and games.collection (single).
  const filters: string[] = [];
  if (detail.franchise_id !== null) filters.push(`franchises = (${detail.franchise_id})`);
  if (detail.collection_id !== null) filters.push(`collection = ${detail.collection_id}`);
  const where = filters.join(' | ');

  const results = await igdbRequest<IgdbGameLite[]>(
    'games',
    `${FIELDS_LITE} where ${where}; sort first_release_date asc; limit 100;`
  );
  return results.map(mapLite);
}

export type DiscoverFilters = {
  genre?: string;
  theme?: string;
  developer?: string;
  publisher?: string;
  maxHours?: number;
  minHours?: number;
  sort?: 'rating' | 'release_date' | 'name';
  limit?: number;
};

async function resolveCompanyId(name: string): Promise<number | null> {
  const sanitized = name.replace(/"/g, '');
  const res = await igdbRequest<{ id: number }[]>(
    'companies',
    `fields id; search "${sanitized}"; limit 1;`
  );
  return res[0]?.id ?? null;
}

async function resolveGenreId(name: string): Promise<number | null> {
  const sanitized = name.replace(/"/g, '');
  const res = await igdbRequest<{ id: number }[]>(
    'genres',
    `fields id; where name ~ *"${sanitized}"*; limit 1;`
  );
  return res[0]?.id ?? null;
}

async function resolveThemeId(name: string): Promise<number | null> {
  const sanitized = name.replace(/"/g, '');
  const res = await igdbRequest<{ id: number }[]>(
    'themes',
    `fields id; where name ~ *"${sanitized}"*; limit 1;`
  );
  return res[0]?.id ?? null;
}

export function discoverGames(filters: DiscoverFilters): Promise<GameLite[]> {
  const key = JSON.stringify(filters);
  return discoverCache.get(key, () => discoverGamesImpl(filters)) as Promise<GameLite[]>;
}

async function discoverGamesImpl(filters: DiscoverFilters): Promise<GameLite[]> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);

  // IGDB renamed `category` → `game_type` in late 2024. Use `game_type = 0` (main game).
  // `version_parent = null` filters out re-releases / alternate editions.
  const where: string[] = ['version_parent = null', 'game_type = 0'];

  if (filters.genre) {
    const id = await resolveGenreId(filters.genre);
    if (id === null) return [];
    where.push(`genres = (${id})`);
  }

  if (filters.theme) {
    const id = await resolveThemeId(filters.theme);
    if (id === null) return [];
    where.push(`themes = (${id})`);
  }

  if (filters.developer) {
    const id = await resolveCompanyId(filters.developer);
    if (id === null) return [];
    where.push(`involved_companies.company = ${id} & involved_companies.developer = true`);
  }

  if (filters.publisher) {
    const id = await resolveCompanyId(filters.publisher);
    if (id === null) return [];
    where.push(`involved_companies.company = ${id} & involved_companies.publisher = true`);
  }

  let sortClause: string;
  if (filters.sort === 'release_date') {
    sortClause = 'sort first_release_date desc;';
  } else if (filters.sort === 'name') {
    sortClause = 'sort name asc;';
  } else {
    sortClause = 'sort total_rating desc;';
    // Use IGDB's user rating (rating) which has higher vote counts than aggregated critic scores.
    // Threshold of 100+ ratings filters out niche games with a handful of perfect scores.
    where.push(
      'total_rating != null',
      'rating_count > 100',
      `first_release_date < ${Math.floor(Date.now() / 1000)}`
    );
  }

  const needHltb = filters.maxHours !== undefined || filters.minHours !== undefined;
  // Over-fetch heavily when HLTB-filtering: most top-rated games are mid-length, so
  // a small pool yields few short or marathon hits. IGDB caps single requests at 500.
  const igdbLimit = needHltb ? 200 : limit;

  const results = await igdbRequest<IgdbGameLite[]>(
    'games',
    `${FIELDS_LITE} where ${where.join(' & ')}; ${sortClause} limit ${igdbLimit};`
  );

  let games = results.map(mapLite);

  if (needHltb) {
    // One IGDB call for all candidate ids — way faster than N serial lookups.
    const hltbMap = await getHltbByGameIds(games.map((g) => g.igdb_id));
    games = games.filter((g) => {
      const hltb = hltbMap.get(g.igdb_id) ?? { main: null, mainExtra: null, completionist: null };
      return passesHltb(filters)({ hltb });
    });
  }

  return games.slice(0, limit);
}

export type PeoplesChoiceEntry = GameLite & { avg_rating: number; tracker_count: number };

export function peoplesChoice(limit = 20): Promise<PeoplesChoiceEntry[]> {
  return peoplesChoiceCache.get(`limit=${limit}`, () => peoplesChoiceImpl(limit)) as Promise<PeoplesChoiceEntry[]>;
}

// Tuning constants for the Bayesian weighted average.
// `MIN_RATERS` filters out games with only one rater so a fluke 10/10 doesn't crown them.
// `PRIOR_MEAN` (~7) is the neutral score we shrink toward — most ratings on a tracker
// hover here. `PRIOR_WEIGHT` controls how aggressively we pull small samples toward
// the prior; higher = more conservative.
// Set to 1 while user-rating volume is low; Bayesian weighting still shrinks
// single-rater entries toward the prior so they don't unfairly dominate.
const MIN_RATERS = 1;
const PRIOR_MEAN = 7;
const PRIOR_WEIGHT = 3;

async function peoplesChoiceImpl(limit = 20): Promise<PeoplesChoiceEntry[]> {
  const { data: ratings } = await supabaseAdmin
    .from('user_games')
    .select('igdb_id, rating')
    .not('rating', 'is', null);

  if (!ratings || ratings.length === 0) return [];

  const buckets = new Map<number, { sum: number; count: number }>();
  for (const r of ratings as { igdb_id: number; rating: number }[]) {
    const b = buckets.get(r.igdb_id) ?? { sum: 0, count: 0 };
    b.sum += r.rating;
    b.count += 1;
    buckets.set(r.igdb_id, b);
  }

  // Bayesian weighted score: (n / (n + w)) * avg + (w / (n + w)) * prior
  const scored = Array.from(buckets.entries())
    .filter(([, { count }]) => count >= MIN_RATERS)
    .map(([igdb_id, { sum, count }]) => {
      const avg = sum / count;
      const weighted = (count / (count + PRIOR_WEIGHT)) * avg + (PRIOR_WEIGHT / (count + PRIOR_WEIGHT)) * PRIOR_MEAN;
      return { igdb_id, avg, count, weighted };
    })
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, limit);

  if (scored.length === 0) return [];

  // Try the games cache first; lazy-fetch anything missing so newly-rated games surface
  // even if no one has opened the detail page yet.
  const ids = scored.map((s) => s.igdb_id);
  const { data: cached } = await supabaseAdmin
    .from('games')
    .select('igdb_id, name, slug, cover_url, year')
    .in('igdb_id', ids);
  const cacheMap = new Map((cached ?? []).map((g) => [g.igdb_id as number, g as GameLite]));

  const missing = ids.filter((id) => !cacheMap.has(id));
  if (missing.length > 0) {
    const fresh = await igdbRequest<IgdbGameLite[]>(
      'games',
      `${FIELDS_LITE} where id = (${missing.join(',')}); limit ${missing.length};`
    );
    for (const g of fresh) cacheMap.set(g.id, mapLite(g));
  }

  return scored
    .map((s): PeoplesChoiceEntry | null => {
      const g = cacheMap.get(s.igdb_id);
      if (!g) return null;
      return { ...g, avg_rating: Number(s.avg.toFixed(2)), tracker_count: s.count };
    })
    .filter((x): x is PeoplesChoiceEntry => x !== null);
}
