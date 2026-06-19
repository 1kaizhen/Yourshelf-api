import { createCache } from './cache.js';
import { getBundleByName } from './steamgriddb.js';

const FIFTEEN_MIN = 15 * 60 * 1000;
const cache = createCache<FreeGame[]>(FIFTEEN_MIN);

// GamerPower platform slugs grouped to the three families the homepage cares about.
const PLATFORM_GROUPS = {
  pc: ['pc', 'steam', 'epic-games-store', 'gog', 'ubisoft', 'origin', 'battlenet', 'drm-free'],
  ps: ['ps4', 'ps5'],
  xbox: ['xbox-one', 'xbox-series-xs', 'xbox-360'],
} as const;

export type FreePlatformFamily = keyof typeof PLATFORM_GROUPS;

export type FreeGame = {
  id: number;
  title: string;
  worth: string | null;
  thumbnail: string;
  image: string;
  description: string;
  instructions: string;
  url: string;
  published_date: string | null;
  end_date: string | null;
  type: string;
  platforms: string[];
  platform_families: FreePlatformFamily[];
  users: number;
  status: string;
};

type GamerPowerGiveaway = {
  id: number;
  title: string;
  worth: string;
  thumbnail: string;
  image: string;
  description: string;
  instructions: string;
  open_giveaway_url: string;
  gamerpower_url?: string;
  published_date: string;
  type: string;
  platforms: string;
  end_date: string;
  users: number;
  status: string;
};

const ALL_PLATFORMS = [
  ...PLATFORM_GROUPS.pc,
  ...PLATFORM_GROUPS.ps,
  ...PLATFORM_GROUPS.xbox,
];

function classifyPlatforms(raw: string): { list: string[]; families: FreePlatformFamily[] } {
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const families = new Set<FreePlatformFamily>();
  for (const p of list) {
    const slug = p.toLowerCase().replace(/\s+/g, '-');
    if ((PLATFORM_GROUPS.pc as readonly string[]).includes(slug) || slug === 'pc') families.add('pc');
    if ((PLATFORM_GROUPS.ps as readonly string[]).includes(slug)) families.add('ps');
    if ((PLATFORM_GROUPS.xbox as readonly string[]).includes(slug)) families.add('xbox');
  }
  return { list, families: [...families] };
}

// Reduce a GamerPower listing to just the game name.
// Removes parentheticals/brackets and trailing giveaway/store/key tags.
function cleanDisplayTitle(title: string): string {
  let out = title;
  // Drop any (..) or [..] groups — these are almost always "(Steam)", "(Epic Games)", etc.
  out = out.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ');
  // Trim trailing "... Giveaway", possibly preceded by store / "key" / "free" words.
  out = out.replace(
    /\s*[-–—|:]?\s*(free\s+)?(steam|epic(?:\s+games?)?|gog|ubisoft|origin|battle\.?net|xbox(?:\s+(?:one|series\s*x\/?s?))?|playstation|ps[45]?|drm[- ]?free|itch\.io)?\s*(key\s+)?giveaway\s*$/i,
    ''
  );
  // Trim trailing store/platform tags on their own (e.g. "Title - Steam", "Title (Epic Games)" after paren strip).
  out = out.replace(
    /\s*[-–—|:]\s*(steam|epic(?:\s+games?)?|gog|ubisoft|origin|battle\.?net|xbox(?:\s+(?:one|series\s*x\/?s?))?|playstation|ps[45]?|drm[- ]?free|itch\.io)\s*$/i,
    ''
  );
  return out.replace(/\s{2,}/g, ' ').trim();
}

function normalize(g: GamerPowerGiveaway): FreeGame {
  const { list, families } = classifyPlatforms(g.platforms);
  return {
    id: g.id,
    title: cleanDisplayTitle(g.title),
    worth: g.worth && g.worth !== 'N/A' ? g.worth : null,
    thumbnail: g.thumbnail,
    image: g.image,
    description: g.description,
    instructions: g.instructions,
    url: g.open_giveaway_url || g.gamerpower_url || '',
    published_date: g.published_date || null,
    end_date: g.end_date && g.end_date !== 'N/A' ? g.end_date : null,
    type: g.type,
    platforms: list,
    platform_families: families,
    users: g.users,
    status: g.status,
  };
}

// Strip subtitles like "(Steam)" or " - DLC" that hurt SGDB matching.
function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\([^)]*\)/g, '')
    .replace(/\s*[-–|:]\s*(free|giveaway|steam|epic|gog|key|dlc).*$/i, '')
    .replace(/\s+giveaway$/i, '')
    .trim();
}

// Replace GamerPower's images with SteamGridDB assets when a match is found.
// Hero (landscape) goes to `image`; portrait grid goes to `thumbnail`. If SGDB
// has no match, the original GamerPower images are kept.
async function replaceImagesWithSgdb(games: FreeGame[]): Promise<FreeGame[]> {
  await Promise.all(
    games.map(async (g) => {
      try {
        const bundle = await getBundleByName(cleanTitleForSearch(g.title));
        if (bundle.hero) g.image = bundle.hero;
        if (bundle.cover) g.thumbnail = bundle.cover;
        else if (bundle.hero) g.thumbnail = bundle.hero;
      } catch {
        // SGDB is best-effort — keep GamerPower's own image on failure.
      }
    })
  );
  return games;
}

async function fetchAllFreeGames(): Promise<FreeGame[]> {
  const url = `https://www.gamerpower.com/api/filter?platform=${ALL_PLATFORMS.join('.')}&type=game`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    // GamerPower returns 201 + `{status:0}` when no giveaways match.
    if (res.status === 201) return [];
    throw new Error(`GamerPower request failed: ${res.status}`);
  }
  const data = (await res.json()) as GamerPowerGiveaway[] | { status: number };
  if (!Array.isArray(data)) return [];
  const games = data
    .map(normalize)
    .filter((g) => g.platform_families.length > 0);
  return replaceImagesWithSgdb(games);
}

export type GetFreeGamesOptions = {
  platform?: FreePlatformFamily | 'all';
  limit?: number;
};

// Rank: Epic (0) → Steam (1) → everything else (2). Lower is better.
function storeRank(g: FreeGame): number {
  const slugs = g.platforms.map((p) => p.toLowerCase().replace(/\s+/g, '-'));
  if (slugs.some((s) => s.includes('epic'))) return 0;
  if (slugs.some((s) => s === 'steam' || s.includes('steam'))) return 1;
  return 2;
}

export async function getFreeGames(opts: GetFreeGamesOptions = {}): Promise<FreeGame[]> {
  const all = await cache.get('all', fetchAllFreeGames);
  const platform = opts.platform ?? 'all';
  const filtered = platform === 'all'
    ? all
    : all.filter((g) => g.platform_families.includes(platform));
  const sorted = [...filtered].sort((a, b) => storeRank(a) - storeRank(b));
  const limit = opts.limit && opts.limit > 0 ? opts.limit : sorted.length;
  return sorted.slice(0, limit);
}
