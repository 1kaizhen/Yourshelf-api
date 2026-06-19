import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { requireUser } from './auth.js';
import {
  getGameDetail,
  getGameSeries,
  searchGames,
  discoverGames,
  peoplesChoice,
  getFeatured,
  getFeaturedList,
  getRandomFeatured,
  getNewestPopular,
  getCardsByIds,
  getCalendarUpcoming,
  getBrowseCategories,
  type DiscoverFilters,
} from './games.js';
import { getFreeGames, type FreePlatformFamily } from './gamerpower.js';

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin/no-origin requests (curl, server-to-server).
    if (!origin) return cb(null, true);
    if (env.ASTRO_ORIGIN.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Lightweight name search.
app.get('/api/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ results: [] });
    const results = await searchGames(q);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// Full game detail (genres, companies, relationships, HLTB).
app.get('/api/games/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid igdb id' });
    }
    const game = await getGameDetail(id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json({ game });
  } catch (err) {
    next(err);
  }
});

// Franchise/collection entries ordered by release date.
app.get('/api/games/:id/series', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid igdb id' });
    }
    const series = await getGameSeries(id);
    res.json({ series });
  } catch (err) {
    next(err);
  }
});

// Discoverability filters.
app.get('/api/discover', async (req, res, next) => {
  try {
    const filters: DiscoverFilters = {
      genre: req.query.genre ? String(req.query.genre) : undefined,
      theme: req.query.theme ? String(req.query.theme) : undefined,
      developer: req.query.developer ? String(req.query.developer) : undefined,
      publisher: req.query.publisher ? String(req.query.publisher) : undefined,
      maxHours: req.query.maxHours ? Number(req.query.maxHours) : undefined,
      minHours: req.query.minHours ? Number(req.query.minHours) : undefined,
      sort: req.query.sort ? (String(req.query.sort) as DiscoverFilters['sort']) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };
    for (const k of ['maxHours', 'minHours'] as const) {
      const v = filters[k];
      if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
        return res.status(400).json({ error: `Invalid ${k}` });
      }
    }
    const results = await discoverGames(filters);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// People's choice — averaged user ratings across all tracked games.
app.get('/api/peoples-choice', async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 50) {
      return res.status(400).json({ error: 'Invalid limit' });
    }
    const results = await peoplesChoice(limit);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// Browse categories — each card carries its top-4 cover URLs.
app.get('/api/browse-categories', async (_req, res, next) => {
  try {
    const categories = await getBrowseCategories();
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// Calendar of upcoming releases, bucketed by date (empty days are omitted).
app.get('/api/calendar', async (req, res, next) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 30;
    if (!Number.isInteger(days) || days <= 0 || days > 180) {
      return res.status(400).json({ error: 'Invalid days' });
    }
    const calendar = await getCalendarUpcoming(days);
    res.json({ calendar });
  } catch (err) {
    next(err);
  }
});

// Newest popular games — actually-recent releases, ready to render.
app.get('/api/newest', async (req, res, next) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 6;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 24) {
      return res.status(400).json({ error: 'Invalid limit' });
    }
    const cards = await getNewestPopular(limit);
    res.json({ cards });
  } catch (err) {
    next(err);
  }
});

// Hydrate a list of IGDB IDs into enriched cards (rating + genres + cover).
// Used by "Games in your list" so the Astro page only has to fetch the user's
// IDs from Supabase and hand them off here.
app.get('/api/cards', async (req, res, next) => {
  try {
    const raw = String(req.query.ids ?? '');
    const ids = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return res.json({ cards: [] });
    if (ids.length > 50) return res.status(400).json({ error: 'Too many ids' });
    const cards = await getCardsByIds(ids);
    // Preserve input order.
    const map = new Map(cards.map((c) => [c.igdb_id, c]));
    res.json({ cards: ids.map((id) => map.get(id)).filter(Boolean) });
  } catch (err) {
    next(err);
  }
});

// Curated top recommendation card (primary).
app.get('/api/featured', async (_req, res, next) => {
  try {
    const featured = await getFeatured();
    res.json({ featured });
  } catch (err) {
    next(err);
  }
});

// Carousel of featured top recommendations.
app.get('/api/featured/list', async (_req, res, next) => {
  try {
    const featured = await getFeaturedList();
    res.json({ featured });
  } catch (err) {
    next(err);
  }
});

// Randomized top recommendations — samples N from a pool of IGDB top-rated +
// most-popular (~200 ids, cached 1h). Frontend "dice" button rerolls this.
app.get('/api/featured/random', async (req, res, next) => {
  try {
    const count = req.query.count ? Number(req.query.count) : 7;
    if (!Number.isInteger(count) || count <= 0 || count > 20) {
      return res.status(400).json({ error: 'Invalid count' });
    }
    const featured = await getRandomFeatured(count);
    res.json({ featured });
  } catch (err) {
    next(err);
  }
});

// Free games (GamerPower) — homepage list, filtered to PC/PS/Xbox.
app.get('/api/free-games', async (req, res, next) => {
  try {
    const platformParam = req.query.platform ? String(req.query.platform).toLowerCase() : 'all';
    const allowed: Array<FreePlatformFamily | 'all'> = ['all', 'pc', 'ps', 'xbox'];
    if (!allowed.includes(platformParam as FreePlatformFamily | 'all')) {
      return res.status(400).json({ error: 'Invalid platform. Use pc, ps, xbox, or all.' });
    }
    const limit = req.query.limit ? Number(req.query.limit) : 12;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 50) {
      return res.status(400).json({ error: 'Invalid limit' });
    }
    const results = await getFreeGames({ platform: platformParam as FreePlatformFamily | 'all', limit });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// Auth probe.
app.get('/me', requireUser, (req, res) => {
  res.json({ userId: req.userId, email: req.userEmail });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

// Listen on 0.0.0.0 so IPv4 'localhost' / 127.0.0.1 / IPv6 '::1' all resolve.
app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`API listening on http://127.0.0.1:${env.PORT}`);
  console.log(`CORS allowed origins: ${env.ASTRO_ORIGIN.join(', ')}`);
  prewarm();
});

function prewarm() {
  // Match the queries the Astro homepage and search page make.
  const tasks: Array<{ label: string; run: () => Promise<unknown> }> = [
    { label: 'top-rated',     run: () => discoverGames({ sort: 'rating', limit: 12 }) },
    { label: 'story-driven',  run: () => discoverGames({ theme: 'Drama', sort: 'rating', limit: 12 }) },
    { label: 'short-games',   run: () => discoverGames({ maxHours: 8, sort: 'rating', limit: 12 }) },
    { label: 'marathon',      run: () => discoverGames({ minHours: 40, sort: 'rating', limit: 12 }) },
    { label: 'peoples-choice',run: () => peoplesChoice(12) },
  ];
  console.log('Pre-warming discover cache…');
  const t0 = Date.now();
  Promise.allSettled(tasks.map(async (t) => {
    const start = Date.now();
    try {
      await t.run();
      console.log(`  ✓ ${t.label} (${Date.now() - start}ms)`);
    } catch (err) {
      console.warn(`  ✗ ${t.label} failed:`, (err as Error).message);
    }
  })).then(() => {
    console.log(`Pre-warm complete in ${Date.now() - t0}ms.`);
  });
}
