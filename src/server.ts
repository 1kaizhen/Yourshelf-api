import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { requireUser } from './auth.js';
import {
  getGameDetail,
  getGameSeries,
  searchGames,
  discoverGames,
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
      developer: req.query.developer ? String(req.query.developer) : undefined,
      publisher: req.query.publisher ? String(req.query.publisher) : undefined,
      maxHours: req.query.maxHours ? Number(req.query.maxHours) : undefined,
      sort: req.query.sort ? (String(req.query.sort) as DiscoverFilters['sort']) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };
    if (filters.maxHours !== undefined && (!Number.isFinite(filters.maxHours) || filters.maxHours <= 0)) {
      return res.status(400).json({ error: 'Invalid maxHours' });
    }
    const results = await discoverGames(filters);
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

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
  console.log(`CORS allowed origin: ${env.ASTRO_ORIGIN}`);
});
