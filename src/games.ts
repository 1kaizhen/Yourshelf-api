import { env } from './env.js';
import { igdbRequest } from './igdb.js';
import { supabaseAdmin } from './supabase.js';
import { getHltbTimes, getHltbByGameIds, type HltbTimes } from './hltb.js';
import { createCache } from './cache.js';
import { getBundleByName, type SgdbBundle } from './steamgriddb.js';

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


// ──────────────── Featured (curated top recommendation) ────────────────

export type FeaturedPlatform = {
  key: "windows" | "playstation" | "xbox" | "switch" | "mac";
  label: string;
};

export type FeaturedCard = {
  igdb_id: number;
  name: string;
  slug: string;
  cover_url: string | null;
  background_url: string;
  title_logo_url: string;
  blurb: string;
  rating: { value: string; source: string };
  hltb: { value: string; label: string };
  platforms: FeaturedPlatform[];
  extra_platform_count: number;
};

const FEATURED_IDS = [
  317627, // Ghost of Yotei
  25076,  // Red Dead Redemption 2
  204350, // The Last of Us Part I
  305152, // Clair Obscur: Expedition 33
  103281, // Halo Infinite
  112875, // God of War Ragnarok
  119133, // Elden Ring
];

// Per-game cover overrides (curated SteamGridDB picks for cards where the
// default first-portrait grid doesn't look great).
const COVER_OVERRIDES: Record<number, string> = {
  317627: 'https://cdn2.steamgriddb.com/grid/8bedba06d32176e1c3bbefa64b30acb5.png',
};

type IgdbArtworkRow = {
  game: number;
  image_id: string;
  width?: number;
  height?: number;
  alpha_channel?: boolean;
  artwork_type?: number;
};

type GameImages = { background?: string; logo?: string };

// IGDB artworks include both wide key art and transparent title logos.
// Logos are flagged by alpha_channel=true with a wide (>2:1) aspect ratio.
async function fetchGameImages(ids: number[]): Promise<Map<number, GameImages>> {
  if (ids.length === 0) return new Map();
  const unique = Array.from(new Set(ids));
  const rows = await igdbRequest<IgdbArtworkRow[]>(
    'artworks',
    `fields game,image_id,width,height,alpha_channel,artwork_type;
     where game = (${unique.join(',')});
     limit ${unique.length * 12};`
  );

  const byGame = new Map<number, IgdbArtworkRow[]>();
  for (const r of rows) {
    const list = byGame.get(r.game) ?? [];
    list.push(r);
    byGame.set(r.game, list);
  }

  function ratio(a: IgdbArtworkRow): number {
    if (!a.width || !a.height) return 0;
    return a.width / a.height;
  }

  const out = new Map<number, GameImages>();
  for (const [game, list] of byGame.entries()) {
    // Logo candidates: transparent PNGs that are landscape (>= 1.5:1) AND not huge
    // full-frame key art (height < 1000 weeds out 2000+px alpha key art that
    // IGDB sometimes tags identically to true title logos).
    const logos = list
      .filter(
        (a) =>
          a.alpha_channel === true &&
          ratio(a) >= 1.5 &&
          (a.height ?? Infinity) < 1000
      )
      .sort((a, b) => ratio(b) - ratio(a));
    // Background candidates: opaque or near-16:9, prefer landscape with the most pixels.
    const backgrounds = list
      .filter((a) => a.alpha_channel !== true && a.width && a.height && a.width > a.height)
      .sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!));

    out.set(game, {
      logo: logos[0]?.image_id,
      background: backgrounds[0]?.image_id ?? list[0]?.image_id,
    });
  }
  return out;
}

// Fetch a screenshot for any game still missing wide artwork.
async function fetchScreenshots(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const unique = Array.from(new Set(ids));
  const rows = await igdbRequest<IgdbArtworkRow[]>(
    'screenshots',
    `fields game,image_id; where game = (${unique.join(',')}); limit ${unique.length * 4};`
  );
  const map = new Map<number, string>();
  for (const r of rows) {
    if (!map.has(r.game)) map.set(r.game, r.image_id);
  }
  return map;
}

function wideImageUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_1080p/${imageId}.jpg`;
}

// IGDB logos are transparent PNGs; serve as .png to preserve alpha.
function logoUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_720p/${imageId}.png`;
}

function upscaledCoverUrl(url: string | null): string | null {
  if (!url) return null;
  return url.replace('/t_cover_big/', '/t_cover_big_2x/');
}

const DEFAULT_PLATFORMS: FeaturedPlatform[] = [
  { key: "windows", label: "Windows" },
  { key: "playstation", label: "PlayStation" },
  { key: "xbox", label: "Xbox" },
];

function fallbackCard(
  id: number,
  detail: Awaited<ReturnType<typeof getGameDetail>>,
  images?: GameImages,
  sgdb?: SgdbBundle
): FeaturedCard | null {
  if (!detail) return null;
  const rating = detail.rating ? `${Math.round(detail.rating)}/100` : "—";
  const hours = detail.hltb?.main ? `${Math.round(detail.hltb.main)} Hrs` : "—";
  const blurb = detail.summary
    ? (detail.summary.length > 220 ? detail.summary.slice(0, 217).trim() + "…" : detail.summary)
    : "";

  const igdbCover = upscaledCoverUrl(detail.cover_url);
  const igdbBackground = images?.background ? wideImageUrl(images.background) : null;
  const igdbLogo = images?.logo ? logoUrl(images.logo) : null;

  // Prefer SteamGridDB (richer hero art + style-tagged logos), fall back to IGDB.
  // Per-game cover overrides win over the auto-picked SGDB grid.
  const cover_url = COVER_OVERRIDES[id] ?? sgdb?.cover ?? igdbCover;
  const background_url = sgdb?.hero ?? igdbBackground ?? igdbCover ?? "";
  const title_logo_url = sgdb?.logo ?? igdbLogo ?? "";

  return {
    igdb_id: id,
    name: detail.name,
    slug: detail.slug,
    cover_url,
    background_url,
    title_logo_url,
    blurb,
    rating: { value: rating, source: "IGDB" },
    hltb: { value: hours, label: "How long to beat" },
    platforms: DEFAULT_PLATFORMS,
    extra_platform_count: 0,
  };
}

export async function getFeaturedList(): Promise<FeaturedCard[]> {
  const unique = Array.from(new Set(FEATURED_IDS));

  const [details, images] = await Promise.all([
    Promise.all(unique.map((id) => getGameDetail(id).catch(() => null))),
    fetchGameImages(unique).catch(() => new Map<number, GameImages>()),
  ]);
  const detailMap = new Map(unique.map((id, i) => [id, details[i]] as const));

  // Backfill any missing wide background with a screenshot.
  const stillMissing = unique.filter((id) => !images.get(id)?.background);
  if (stillMissing.length) {
    const shots = await fetchScreenshots(stillMissing).catch(() => new Map<number, string>());
    for (const [id, ss] of shots.entries()) {
      const existing = images.get(id) ?? {};
      images.set(id, { ...existing, background: ss });
    }
  }

  // SteamGridDB lookup keyed by game name (returns hero, logo, cover URLs).
  const sgdbMap = new Map<number, SgdbBundle>();
  await Promise.all(
    unique.map(async (id) => {
      const d = detailMap.get(id);
      if (!d?.name) return;
      try {
        const bundle = await getBundleByName(d.name);
        sgdbMap.set(id, bundle);
      } catch (err) {
        console.warn(`[sgdb] lookup failed for ${d.name}:`, (err as Error).message);
      }
    })
  );

  const cards: FeaturedCard[] = [];
  for (const id of FEATURED_IDS) {
    const d = detailMap.get(id) ?? null;
    const card = fallbackCard(id, d, images.get(id), sgdbMap.get(id));
    if (card) cards.push(card);
  }
  return cards;
}

// Kept for backwards compatibility — returns the first (primary) featured card.
export async function getFeatured(): Promise<FeaturedCard> {
  const list = await getFeaturedList();
  return list[0];
}

// ──────────────── Enriched cards (for homepage rows) ────────────────

export type EnrichedCard = GameLite & {
  rating: number | null;
  rating_count: number | null;
  genres: string[];
  hours: number | null;
};

function toEnrichedCard(d: GameDetail | null): EnrichedCard | null {
  if (!d) return null;
  return {
    igdb_id: d.igdb_id,
    name: d.name,
    slug: d.slug,
    cover_url: upscaledCoverUrl(d.cover_url),
    year: d.year,
    rating: d.rating ? Number((d.rating / 10).toFixed(1)) : null,
    rating_count: d.rating_count ?? null,
    genres: (d.genres ?? []).slice(0, 4),
    hours: d.hltb?.main ? Math.round(d.hltb.main) : null,
  };
}

// Hydrate any list of IGDB IDs into enriched homepage cards, preserving order.
export async function getCardsByIds(ids: number[]): Promise<EnrichedCard[]> {
  if (ids.length === 0) return [];
  const details = await Promise.all(ids.map((id) => getGameDetail(id).catch(() => null)));
  return details.map(toEnrichedCard).filter((c): c is EnrichedCard => c !== null);
}

// "Newest Games": actual recent releases sorted by recency, filtered to ones
// that have made it onto a real game record (cover + name). Includes games up
// to ~90 days in the future so things like 007: First Light surface immediately.
type IgdbGameRecent = IgdbGameLite & {
  total_rating?: number;
  total_rating_count?: number;
  genres?: { id: number; name: string }[];
};

export async function getNewestPopular(limit = 6): Promise<EnrichedCard[]> {
  const now = Math.floor(Date.now() / 1000);
  const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60;
  const ninetyDaysFromNow = now + 90 * 24 * 60 * 60;

  const rows = await igdbRequest<IgdbGameRecent[]>(
    'games',
    `fields id,name,slug,cover.image_id,first_release_date,total_rating,total_rating_count,genres.name;
     where first_release_date >= ${twoYearsAgo}
       & first_release_date <= ${ninetyDaysFromNow}
       & cover != null
       & total_rating_count > 5;
     sort first_release_date desc;
     limit ${limit};`
  );

  // Fetch HLTB + genres via the cached getGameDetail path so cards have
  // genre chips + hours like the other rows.
  return getCardsByIds(rows.map((g) => g.id));
}

// ──────────────── Browse Categories ────────────────

export type BrowseCategory = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  covers: string[];
};

type BrowseCategoryDef = Omit<BrowseCategory, 'covers'> & { params: DiscoverFilters };

const BROWSE_CATEGORIES_DEF: BrowseCategoryDef[] = [
  {
    id: 'top-100',
    title: 'Top 100 Games List',
    subtitle: 'Find your next wishlist game here. Rated by top Gaming Creators.',
    href: '/browse?sort=rating',
    params: { sort: 'rating', limit: 4 },
  },
  {
    id: 'story-driven',
    title: 'Story-Driven Games',
    subtitle: 'Narrative-first journeys worth playing.',
    href: '/browse?theme=Drama&sort=rating',
    params: { theme: 'Drama', sort: 'rating', limit: 4 },
  },
  {
    id: 'shooter',
    title: 'Shooter Games',
    subtitle: 'High-octane action, gunplay, and tactical shooters.',
    href: '/browse?genre=Shooter&sort=rating',
    params: { genre: 'Shooter', sort: 'rating', limit: 4 },
  },
  {
    id: 'jrpg',
    title: 'JRPG Games',
    subtitle: 'The genre that never gets old.',
    href: '/browse?genre=Role-playing+(RPG)&sort=rating',
    params: { genre: 'Role-playing (RPG)', sort: 'rating', limit: 4 },
  },
  {
    id: 'platformer',
    title: 'Hottest Platformer Games',
    subtitle: 'Run, jump, and grind through the best.',
    href: '/browse?genre=Platform&sort=rating',
    params: { genre: 'Platform', sort: 'rating', limit: 4 },
  },
  {
    id: 'short',
    title: 'Short Games',
    subtitle: 'Great experiences in under 8 hours.',
    href: '/browse?maxHours=8&sort=rating',
    params: { maxHours: 8, sort: 'rating', limit: 4 },
  },
];

export async function getBrowseCategories(): Promise<BrowseCategory[]> {
  const results = await Promise.all(
    BROWSE_CATEGORIES_DEF.map(async (def): Promise<BrowseCategory> => {
      try {
        const games = await discoverGames({ ...def.params, limit: 4 });
        const covers = games
          .slice(0, 4)
          .map((g) => upscaledCoverUrl(g.cover_url))
          .filter((u): u is string => !!u);
        return {
          id: def.id,
          title: def.title,
          subtitle: def.subtitle,
          href: def.href,
          covers,
        };
      } catch {
        return {
          id: def.id,
          title: def.title,
          subtitle: def.subtitle,
          href: def.href,
          covers: [],
        };
      }
    })
  );
  return results;
}

// ──────────────── Games Calendar (upcoming releases) ────────────────

type IgdbCalendarRow = IgdbGameLite & {
  hypes?: number;
  total_rating_count?: number;
  genres?: { id: number; name: string }[];
};

export type CalendarGame = {
  igdb_id: number;
  name: string;
  slug: string;
  cover_url: string | null;   // portrait poster — SGDB grid preferred
  hero_url: string | null;    // wide art used as the card background
  year: number | null;
  release_date: string;       // ISO date
  genres: string[];
};

export type CalendarDay = {
  date: string;       // "2026-06-19"
  day: number;        // 19
  month: string;      // "JUN"
  weekday: string;    // "Friday"
  games: CalendarGame[];
};

export async function getCalendarUpcoming(daysAhead = 30, maxGames = 60): Promise<CalendarDay[]> {
  const now = Math.floor(Date.now() / 1000);
  const future = now + daysAhead * 24 * 60 * 60;

  const rows = await igdbRequest<IgdbCalendarRow[]>(
    'games',
    `fields id,name,slug,cover.image_id,first_release_date,hypes,total_rating_count,genres.name;
     where first_release_date >= ${now}
       & first_release_date <= ${future}
       & cover != null
       & (hypes > 0 | total_rating_count > 0);
     sort hypes desc;
     limit ${maxGames};`
  );

  // SGDB lookups (cached). One per unique game name.
  const sgdbEntries = await Promise.all(
    rows.map(async (g) => {
      try {
        const bundle = await getBundleByName(g.name);
        return [g.id, bundle] as const;
      } catch {
        return [g.id, { sgdbId: null, logo: null, hero: null, cover: null }] as const;
      }
    })
  );
  const sgdbMap = new Map(sgdbEntries);

  // Bucket by ISO date.
  const byDate = new Map<string, CalendarGame[]>();
  for (const g of rows) {
    if (!g.first_release_date) continue;
    const date = new Date(g.first_release_date * 1000);
    const iso = date.toISOString().slice(0, 10);
    const sgdb = sgdbMap.get(g.id);
    const igdbCover = upscaledCoverUrl(coverUrl(g.cover?.image_id));

    // Cover slot uses the portrait poster: SGDB grid first, IGDB cover as fallback.
    const game: CalendarGame = {
      igdb_id: g.id,
      name: g.name,
      slug: g.slug,
      cover_url: sgdb?.cover ?? igdbCover,
      hero_url: sgdb?.hero ?? igdbCover,
      year: yearOf(g.first_release_date),
      release_date: date.toISOString(),
      genres: (g.genres ?? []).map((x) => x.name).slice(0, 4),
    };

    const list = byDate.get(iso) ?? [];
    list.push(game);
    byDate.set(iso, list);
  }

  // Sort each bucket so higher-hype titles surface first inside the day.
  // Then keep only days that have at least one game and sort by date ascending.
  const sortedDates = Array.from(byDate.keys()).sort();
  return sortedDates.map((iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    return {
      date: iso,
      day: d.getUTCDate(),
      month: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase(),
      weekday: d.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      games: byDate.get(iso)!,
    };
  });
}
