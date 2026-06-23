// Expanded /api/games/:id payload — pulls all IGDB fields the new detail page
// needs and resolves enum integers to strings.
//
// Caching: one in-memory blob per game (TTL = GAMES_CACHE_TTL_HOURS). The
// sub-endpoints (/screenshots, /similar, /dlcs, /companies) all read from this
// same cache so there is no parallel cache to keep in sync.

import { env } from './env.js';
import { igdbRequest } from './igdb.js';
import { createCache } from './cache.js';
import { getGameDetail, type GameDetail, type GameLite } from './games.js';
import { findGameId, getLogos, type SgdbAsset } from './steamgriddb.js';
import {
  EXTERNAL_GAME_CATEGORY,
  GAME_CATEGORY,
  GAME_STATUS,
  LANGUAGE_SUPPORT_TYPE,
  PLATFORM_CATEGORY,
  REGION,
  WEBSITE_CATEGORY,
  resolve,
} from './igdbEnums.js';

const TTL_MS = env.GAMES_CACHE_TTL_HOURS * 60 * 60 * 1000;
const expandedCache = createCache<GameDetailExpanded | null>(TTL_MS);

// ──────────────── Response types ────────────────

export type Image = { id: number; url: string; url_hd: string };
export type Video = {
  id: number;
  name: string | null;
  video_id: string;
  youtube_url: string;
  thumbnail_url: string;
};
export type Platform = {
  id: number;
  name: string;
  abbreviation: string | null;
  slug: string | null;
  logo_url: string | null;
  category: string | null;
};
export type ReleaseDate = {
  id: number;
  platform_id: number | null;
  platform_name: string | null;
  date: string | null;
  human: string | null;
  region: string | null;
  y: number | null;
  m: number | null;
};
export type Named = { id: number; name: string };
export type FranchiseRef = { id: number; name: string; slug: string | null };
export type MultiplayerMode = {
  platform_id: number | null;
  campaigncoop: boolean;
  dropin: boolean;
  lancoop: boolean;
  offlinecoop: boolean;
  offlinecoopmax: number | null;
  offlinemax: number | null;
  onlinecoop: boolean;
  onlinecoopmax: number | null;
  onlinemax: number | null;
  splitscreen: boolean;
};
export type LanguageSupport = {
  language: { id: number; name: string; native_name: string | null; locale: string | null };
  supports: Array<'audio' | 'subtitles' | 'interface'>;
};
export type EsrbRating = {
  rating: string | null;
  content_descriptions: string[];
};
export type Website = {
  id: number;
  category: string | null;
  url: string;
  trusted: boolean;
};
export type InvolvedCompany = {
  company: { id: number; name: string; slug: string | null; logo_url: string | null };
  developer: boolean;
  publisher: boolean;
  porting: boolean;
  supporting: boolean;
};
export type ExternalGame = {
  category: string | null;
  uid: string | null;
  url: string | null;
};

export type GameDetailExpanded = GameDetail & {
  storyline: string | null;
  aggregated_rating: number | null;
  aggregated_rating_count: number | null;
  total_rating: number | null;
  total_rating_count: number | null;
  category: number | null;
  category_label: string | null;
  status: number | null;
  status_label: string | null;
  cover_url_hd: string | null;
  logo_url: string | null;
  screenshots: Image[];
  artworks: Image[];
  videos: Video[];
  platforms: Platform[];
  release_dates: ReleaseDate[];
  game_modes: Named[];
  themes: Named[];
  player_perspectives: Named[];
  keywords: Named[];
  game_engines: Named[];
  multiplayer_modes: MultiplayerMode[];
  language_supports: LanguageSupport[];
  esrb: EsrbRating | null;
  websites: Website[];
  involved_companies: InvolvedCompany[];
  similar_games: GameLite[];
  parent_game: GameLite | null;
  version_parent: GameLite | null;
  bundles: GameLite[];
  franchises: FranchiseRef[];
  collections: FranchiseRef[];
  external_games: ExternalGame[];
};

// ──────────────── IGDB raw types ────────────────

type RawCover = { image_id: string };
type RawImage = { id: number; image_id: string };
type RawVideo = { id: number; name?: string; video_id: string };
type RawPlatform = {
  id: number;
  name: string;
  abbreviation?: string;
  slug?: string;
  category?: number;
  platform_logo?: { image_id: string };
};
type RawReleaseDate = {
  id: number;
  platform?: { id: number; name?: string } | number;
  date?: number;
  human?: string;
  region?: number;
  y?: number;
  m?: number;
};
type RawNamed = { id: number; name: string };
type RawFranchise = { id: number; name: string; slug?: string };
type RawMultiplayer = {
  id: number;
  platform?: number;
  campaigncoop?: boolean;
  dropin?: boolean;
  lancoop?: boolean;
  offlinecoop?: boolean;
  offlinecoopmax?: number;
  offlinemax?: number;
  onlinecoop?: boolean;
  onlinecoopmax?: number;
  onlinemax?: number;
  splitscreen?: boolean;
};
type RawLanguageSupport = {
  id: number;
  language?: { id: number; name: string; native_name?: string; locale?: string };
  language_support_type?: { id: number };
};
type RawAgeRating = {
  id: number;
  organization?: { id: number; name: string };
  rating_category?: { id: number; rating: string };
  rating_content_descriptions?: { id: number; description: string }[];
};
type RawWebsite = { id: number; category?: number; url: string; trusted?: boolean };
type RawInvolved = {
  id: number;
  developer?: boolean;
  publisher?: boolean;
  porting?: boolean;
  supporting?: boolean;
  company?: { id: number; name: string; slug?: string; logo?: { image_id: string } };
};
type RawExternal = { id: number; category?: number; uid?: string; url?: string };
type RawGameLite = {
  id: number;
  name: string;
  slug: string;
  cover?: RawCover;
  first_release_date?: number;
};
type RawGameExpanded = RawGameLite & {
  storyline?: string;
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  total_rating?: number;
  total_rating_count?: number;
  game_type?: number;
  status?: number;
  screenshots?: RawImage[];
  artworks?: RawImage[];
  videos?: RawVideo[];
  platforms?: RawPlatform[];
  release_dates?: RawReleaseDate[];
  game_modes?: RawNamed[];
  themes?: RawNamed[];
  player_perspectives?: RawNamed[];
  keywords?: RawNamed[];
  game_engines?: RawNamed[];
  multiplayer_modes?: RawMultiplayer[];
  language_supports?: RawLanguageSupport[];
  age_ratings?: RawAgeRating[];
  websites?: RawWebsite[];
  involved_companies?: RawInvolved[];
  similar_games?: RawGameLite[];
  parent_game?: RawGameLite;
  version_parent?: RawGameLite;
  bundles?: RawGameLite[];
  franchises?: RawFranchise[];
  collections?: RawFranchise[];
  external_games?: RawExternal[];
};

// ──────────────── Helpers ────────────────

function imgUrl(imageId: string | undefined, size: string, ext: 'jpg' | 'png' = 'jpg'): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.${ext}` : null;
}

function yearOf(unix?: number): number | null {
  return unix ? new Date(unix * 1000).getUTCFullYear() : null;
}

function mapLite(g: RawGameLite): GameLite {
  return {
    igdb_id: g.id,
    name: g.name,
    slug: g.slug,
    cover_url: imgUrl(g.cover?.image_id, 't_cover_big'),
    year: yearOf(g.first_release_date),
  };
}

function mapImage(raw: RawImage, medSize: string, hdSize: string): Image {
  return {
    id: raw.id,
    url: imgUrl(raw.image_id, medSize)!,
    url_hd: imgUrl(raw.image_id, hdSize)!,
  };
}

function mapPlatform(p: RawPlatform): Platform {
  return {
    id: p.id,
    name: p.name,
    abbreviation: p.abbreviation ?? null,
    slug: p.slug ?? null,
    logo_url: imgUrl(p.platform_logo?.image_id, 't_logo_med'),
    category: resolve(PLATFORM_CATEGORY, p.category),
  };
}

function mapVideo(v: RawVideo): Video {
  return {
    id: v.id,
    name: v.name ?? null,
    video_id: v.video_id,
    youtube_url: `https://www.youtube.com/watch?v=${v.video_id}`,
    thumbnail_url: `https://img.youtube.com/vi/${v.video_id}/hqdefault.jpg`,
  };
}

function mapReleaseDate(r: RawReleaseDate): ReleaseDate {
  const platformObj = typeof r.platform === 'object' ? r.platform : null;
  return {
    id: r.id,
    platform_id: platformObj?.id ?? (typeof r.platform === 'number' ? r.platform : null),
    platform_name: platformObj?.name ?? null,
    date: r.date ? new Date(r.date * 1000).toISOString() : null,
    human: r.human ?? null,
    region: resolve(REGION, r.region),
    y: r.y ?? null,
    m: r.m ?? null,
  };
}

function mapMultiplayer(m: RawMultiplayer): MultiplayerMode {
  return {
    platform_id: m.platform ?? null,
    campaigncoop: !!m.campaigncoop,
    dropin: !!m.dropin,
    lancoop: !!m.lancoop,
    offlinecoop: !!m.offlinecoop,
    offlinecoopmax: m.offlinecoopmax ?? null,
    offlinemax: m.offlinemax ?? null,
    onlinecoop: !!m.onlinecoop,
    onlinecoopmax: m.onlinecoopmax ?? null,
    onlinemax: m.onlinemax ?? null,
    splitscreen: !!m.splitscreen,
  };
}

// Group multiple language_supports rows for the same language into a single
// entry with a `supports` array — frontend expects one row per language.
function mapLanguageSupports(rows: RawLanguageSupport[] | undefined): LanguageSupport[] {
  const map = new Map<number, LanguageSupport>();
  for (const r of rows ?? []) {
    if (!r.language) continue;
    const existing = map.get(r.language.id) ?? {
      language: {
        id: r.language.id,
        name: r.language.name,
        native_name: r.language.native_name ?? null,
        locale: r.language.locale ?? null,
      },
      supports: [],
    };
    const kind = resolve(LANGUAGE_SUPPORT_TYPE, r.language_support_type?.id);
    if (kind && !existing.supports.includes(kind)) existing.supports.push(kind);
    map.set(r.language.id, existing);
  }
  return Array.from(map.values());
}

function pickEsrb(ratings: RawAgeRating[] | undefined): EsrbRating | null {
  const esrb = (ratings ?? []).find((a) => a.organization?.name === 'ESRB');
  if (!esrb) return null;
  return {
    rating: esrb.rating_category?.rating ?? null,
    content_descriptions: (esrb.rating_content_descriptions ?? []).map((c) => c.description),
  };
}

function mapWebsite(w: RawWebsite): Website {
  return {
    id: w.id,
    category: resolve(WEBSITE_CATEGORY, w.category),
    url: w.url,
    trusted: !!w.trusted,
  };
}

function mapInvolved(i: RawInvolved): InvolvedCompany | null {
  if (!i.company) return null;
  return {
    company: {
      id: i.company.id,
      name: i.company.name,
      slug: i.company.slug ?? null,
      logo_url: imgUrl(i.company.logo?.image_id, 't_logo_med'),
    },
    developer: !!i.developer,
    publisher: !!i.publisher,
    porting: !!i.porting,
    supporting: !!i.supporting,
  };
}

function mapExternal(e: RawExternal): ExternalGame {
  return {
    category: resolve(EXTERNAL_GAME_CATEGORY, e.category),
    uid: e.uid ?? null,
    url: e.url ?? null,
  };
}

function mapFranchise(f: RawFranchise): FranchiseRef {
  return { id: f.id, name: f.name, slug: f.slug ?? null };
}

// ──────────────── Clear-logo resolution ────────────────
// SteamGridDB has the best coverage of transparent title-logo art. Fall back
// to the Steam CDN logo.png (verified via HEAD) when the game has a known
// Steam appid but no SGDB match.

function pickSgdbLogo(assets: SgdbAsset[]): string | null {
  if (!assets.length) return null;
  const isPng = (a: SgdbAsset) => a.mime === 'image/png' || a.url.toLowerCase().endsWith('.png');
  const order = ['official', 'white', 'custom', 'black'];
  for (const style of order) {
    const hit = assets.find((a) => a.style === style && isPng(a));
    if (hit) return hit.url;
    const anyStyle = assets.find((a) => a.style === style);
    if (anyStyle) return anyStyle.url;
  }
  return assets.find(isPng)?.url ?? assets[0]?.url ?? null;
}

async function steamLogoIfExists(appid: string): Promise<string | null> {
  const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/logo.png`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

async function resolveLogoUrl(
  name: string,
  externals: RawExternal[] | undefined
): Promise<string | null> {
  try {
    const sgdbId = await findGameId(name);
    if (sgdbId) {
      const logos = await getLogos(sgdbId, { styles: ['official', 'white', 'custom'] });
      const picked = pickSgdbLogo(logos);
      if (picked) return picked;
    }
  } catch {
    // SGDB best-effort; fall through to Steam CDN.
  }

  const steamAppid = (externals ?? []).find((e) => e.category === 1)?.uid;
  if (steamAppid) {
    const steam = await steamLogoIfExists(steamAppid);
    if (steam) return steam;
  }

  return null;
}

// ──────────────── Field selector ────────────────

const EXPANDED_FIELDS = [
  'id', 'name', 'slug', 'cover.image_id', 'first_release_date',
  'storyline', 'aggregated_rating', 'aggregated_rating_count',
  'total_rating', 'total_rating_count', 'game_type', 'status',
  'screenshots.image_id',
  'artworks.image_id',
  'videos.name', 'videos.video_id',
  'platforms.name', 'platforms.abbreviation', 'platforms.slug',
  'platforms.category', 'platforms.platform_logo.image_id',
  'release_dates.platform.name', 'release_dates.date', 'release_dates.human',
  'release_dates.region', 'release_dates.y', 'release_dates.m',
  'game_modes.name',
  'themes.name',
  'player_perspectives.name',
  'keywords.name',
  'game_engines.name',
  'multiplayer_modes.platform', 'multiplayer_modes.campaigncoop',
  'multiplayer_modes.dropin', 'multiplayer_modes.lancoop',
  'multiplayer_modes.offlinecoop', 'multiplayer_modes.offlinecoopmax',
  'multiplayer_modes.offlinemax', 'multiplayer_modes.onlinecoop',
  'multiplayer_modes.onlinecoopmax', 'multiplayer_modes.onlinemax',
  'multiplayer_modes.splitscreen',
  'language_supports.language.name', 'language_supports.language.native_name',
  'language_supports.language.locale', 'language_supports.language_support_type',
  'age_ratings.organization.name',
  'age_ratings.rating_category.rating',
  'age_ratings.rating_content_descriptions.description',
  'websites.category', 'websites.url', 'websites.trusted',
  'involved_companies.developer', 'involved_companies.publisher',
  'involved_companies.porting', 'involved_companies.supporting',
  'involved_companies.company.name', 'involved_companies.company.slug',
  'involved_companies.company.logo.image_id',
  'similar_games.name', 'similar_games.slug', 'similar_games.cover.image_id',
  'similar_games.first_release_date',
  'parent_game.name', 'parent_game.slug', 'parent_game.cover.image_id',
  'parent_game.first_release_date',
  'version_parent.name', 'version_parent.slug', 'version_parent.cover.image_id',
  'version_parent.first_release_date',
  'bundles.name', 'bundles.slug', 'bundles.cover.image_id', 'bundles.first_release_date',
  'franchises.name', 'franchises.slug',
  'collections.name', 'collections.slug',
  'external_games.category', 'external_games.uid', 'external_games.url',
].join(',');

// ──────────────── Builder ────────────────

async function buildExpanded(igdbId: number): Promise<GameDetailExpanded | null> {
  // getGameDetail handles the supabase-cached existing fields (genres,
  // developers, dlcs[], hltb, …). Reuse it so we don't duplicate that logic.
  const base = await getGameDetail(igdbId);

  // One IGDB call gets every new field via field.* expansion.
  const rows = await igdbRequest<RawGameExpanded[]>(
    'games',
    `fields ${EXPANDED_FIELDS}; where id = ${igdbId};`
  );
  const raw = rows[0];
  if (!base && !raw) return null;
  if (!raw) return base ? { ...base, ...emptyExpanded() } as GameDetailExpanded : null;

  const expanded: GameDetailExpanded = {
    // Existing GameDetail fields — preserved exactly so existing consumers
    // see no shape change. Fall back to the IGDB row only if supabase missed.
    ...(base ?? fallbackBaseFromRaw(raw)),

    storyline: raw.storyline ?? null,
    aggregated_rating: raw.aggregated_rating ?? null,
    aggregated_rating_count: raw.aggregated_rating_count ?? null,
    total_rating: raw.total_rating ?? null,
    total_rating_count: raw.total_rating_count ?? null,
    category: raw.game_type ?? null,
    category_label: resolve(GAME_CATEGORY, raw.game_type),
    status: raw.status ?? null,
    status_label: resolve(GAME_STATUS, raw.status),
    cover_url_hd: imgUrl(raw.cover?.image_id, 't_cover_big_2x'),
    logo_url: await resolveLogoUrl(raw.name, raw.external_games),
    screenshots: (raw.screenshots ?? []).map((s) => mapImage(s, 't_screenshot_med', 't_screenshot_huge')),
    artworks: (raw.artworks ?? []).map((a) => mapImage(a, 't_screenshot_med', 't_screenshot_huge')),
    videos: (raw.videos ?? []).map(mapVideo),
    platforms: (raw.platforms ?? []).map(mapPlatform),
    release_dates: (raw.release_dates ?? []).map(mapReleaseDate),
    game_modes: (raw.game_modes ?? []).map((g) => ({ id: g.id, name: g.name })),
    themes: (raw.themes ?? []).map((g) => ({ id: g.id, name: g.name })),
    player_perspectives: (raw.player_perspectives ?? []).map((g) => ({ id: g.id, name: g.name })),
    keywords: (raw.keywords ?? [])
      .map((g) => ({ id: g.id, name: g.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 30),
    game_engines: (raw.game_engines ?? []).map((g) => ({ id: g.id, name: g.name })),
    multiplayer_modes: (raw.multiplayer_modes ?? []).map(mapMultiplayer),
    language_supports: mapLanguageSupports(raw.language_supports),
    esrb: pickEsrb(raw.age_ratings),
    websites: (raw.websites ?? []).map(mapWebsite),
    involved_companies: (raw.involved_companies ?? [])
      .map(mapInvolved)
      .filter((x): x is InvolvedCompany => x !== null),
    similar_games: (raw.similar_games ?? []).map(mapLite).slice(0, 12),
    parent_game: raw.parent_game ? mapLite(raw.parent_game) : null,
    version_parent: raw.version_parent ? mapLite(raw.version_parent) : null,
    bundles: (raw.bundles ?? []).map(mapLite),
    franchises: (raw.franchises ?? []).map(mapFranchise),
    collections: (raw.collections ?? []).map(mapFranchise),
    external_games: (raw.external_games ?? []).map(mapExternal),
  };

  return expanded;
}

// Empty defaults so the shape is stable when IGDB returns nothing.
function emptyExpanded() {
  return {
    storyline: null,
    aggregated_rating: null,
    aggregated_rating_count: null,
    total_rating: null,
    total_rating_count: null,
    category: null,
    category_label: null,
    status: null,
    status_label: null,
    cover_url_hd: null,
    logo_url: null,
    screenshots: [],
    artworks: [],
    videos: [],
    platforms: [],
    release_dates: [],
    game_modes: [],
    themes: [],
    player_perspectives: [],
    keywords: [],
    game_engines: [],
    multiplayer_modes: [],
    language_supports: [],
    esrb: null,
    websites: [],
    involved_companies: [],
    similar_games: [],
    parent_game: null,
    version_parent: null,
    bundles: [],
    franchises: [],
    collections: [],
    external_games: [],
  };
}

// If the supabase row is missing (very rare — first hit on a brand-new game),
// derive the GameDetail-shaped base from the IGDB row so the response shape
// stays valid. Lacks HLTB/genres/devs, but the next call will populate them.
function fallbackBaseFromRaw(raw: RawGameExpanded): GameDetail {
  return {
    igdb_id: raw.id,
    name: raw.name,
    slug: raw.slug,
    cover_url: imgUrl(raw.cover?.image_id, 't_cover_big'),
    year: yearOf(raw.first_release_date),
    summary: null,
    release_date: raw.first_release_date ? new Date(raw.first_release_date * 1000).toISOString() : null,
    rating: raw.total_rating ?? null,
    rating_count: raw.total_rating_count ?? null,
    genres: [],
    developers: [],
    publishers: [],
    dlcs: [],
    expansions: [],
    remakes: [],
    remasters: [],
    franchise_id: null,
    collection_id: null,
    hltb: { main: null, mainExtra: null, completionist: null },
    updated_at: new Date().toISOString(),
  };
}

// ──────────────── Public API ────────────────

export function getGameDetailExpanded(igdbId: number): Promise<GameDetailExpanded | null> {
  return expandedCache.get(`game:${igdbId}`, () => buildExpanded(igdbId));
}

// ──────────────── Sub-endpoint helpers ────────────────
// These call getGameDetailExpanded so they share the one cache entry.

// Full related-game graph (uncapped). similar_games on the expanded blob is
// capped at 12 to keep the main payload tight; this endpoint returns the
// uncapped list by re-querying IGDB directly.
export async function getSimilarGames(igdbId: number): Promise<GameLite[]> {
  const rows = await igdbRequest<RawGameLite[]>(
    'games',
    `fields similar_games.name,similar_games.slug,similar_games.cover.image_id,similar_games.first_release_date;
     where id = ${igdbId};`
  ).then((r) => (r[0] as { similar_games?: RawGameLite[] })?.similar_games ?? []);
  return rows.map(mapLite);
}

export type RelatedGameGraph = {
  dlcs: GameLite[];
  expansions: GameLite[];
  remakes: GameLite[];
  remasters: GameLite[];
  standalone_expansions: GameLite[];
  expanded_games: GameLite[];
  forks: GameLite[];
  ports: GameLite[];
};

export async function getRelatedGames(igdbId: number): Promise<RelatedGameGraph> {
  type Raw = {
    dlcs?: RawGameLite[];
    expansions?: RawGameLite[];
    remakes?: RawGameLite[];
    remasters?: RawGameLite[];
    standalone_expansions?: RawGameLite[];
    expanded_games?: RawGameLite[];
    forks?: RawGameLite[];
    ports?: RawGameLite[];
  };
  const childFields = (key: string) =>
    `${key}.name,${key}.slug,${key}.cover.image_id,${key}.first_release_date`;
  const keys = [
    'dlcs', 'expansions', 'remakes', 'remasters',
    'standalone_expansions', 'expanded_games', 'forks', 'ports',
  ];
  const fields = keys.map(childFields).join(',');
  const rows = await igdbRequest<Raw[]>('games', `fields ${fields}; where id = ${igdbId};`);
  const r = rows[0] ?? {};
  return {
    dlcs: (r.dlcs ?? []).map(mapLite),
    expansions: (r.expansions ?? []).map(mapLite),
    remakes: (r.remakes ?? []).map(mapLite),
    remasters: (r.remasters ?? []).map(mapLite),
    standalone_expansions: (r.standalone_expansions ?? []).map(mapLite),
    expanded_games: (r.expanded_games ?? []).map(mapLite),
    forks: (r.forks ?? []).map(mapLite),
    ports: (r.ports ?? []).map(mapLite),
  };
}
