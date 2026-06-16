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
  type DiscoverFilters,
} from './games.js';

const app = express();
app.use(cors({ origin: env.ASTRO_ORIGIN, credentials: true }));
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
  console.log(`CORS allowed origin: ${env.ASTRO_ORIGIN}`);
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
