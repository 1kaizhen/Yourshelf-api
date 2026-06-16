import { env } from './env.js';
import { igdbRequest } from './igdb.js';
import { supabaseAdmin } from './supabase.js';
import { getHltbTimes, type HltbTimes } from './hltb.js';

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
  developer?: string;
  publisher?: string;
  maxHours?: number;
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

export async function discoverGames(filters: DiscoverFilters): Promise<GameLite[]> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);

  const where: string[] = ['version_parent = null', 'category = 0'];

  if (filters.genre) {
    const id = await resolveGenreId(filters.genre);
    if (id === null) return [];
    where.push(`genres = (${id})`);
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

  const sortClause =
    filters.sort === 'release_date'
      ? 'sort first_release_date desc;'
      : filters.sort === 'name'
      ? 'sort name asc;'
      : 'sort total_rating desc;';

  // Over-fetch when maxHours is set so we can filter post-HLTB.
  const igdbLimit = filters.maxHours ? Math.min(limit * 3, 50) : limit;

  const results = await igdbRequest<IgdbGameLite[]>(
    'games',
    `${FIELDS_LITE} where ${where.join(' & ')}; ${sortClause} limit ${igdbLimit};`
  );

  let games = results.map(mapLite);

  if (filters.maxHours) {
    const enriched = await Promise.all(
      games.map(async (g) => ({ game: g, hltb: await getHltbTimes(g.name) }))
    );
    games = enriched
      .filter(({ hltb }) => hltb.main !== null && hltb.main <= filters.maxHours!)
      .map(({ game }) => game);
  }

  return games.slice(0, limit);
}
