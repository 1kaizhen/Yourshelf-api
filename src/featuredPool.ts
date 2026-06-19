import { supabaseAdmin } from './supabase.js';
import {
  fetchRandomPoolIds,
  buildFeaturedCardsForIds,
  DEFAULT_PLATFORMS,
  type FeaturedCard,
} from './games.js';

const TARGET_POOL_SIZE = 200;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const BUILD_CONCURRENCY = 8;

type FeaturedPoolRow = {
  igdb_id: number;
  name: string;
  slug: string;
  cover_url: string | null;
  background_url: string;
  title_logo_url: string;
  blurb: string;
  rating_value: string;
  rating_source: string;
  hltb_value: string;
  hltb_label: string;
  refreshed_at?: string;
};

function cardToRow(c: FeaturedCard, refreshedAt: string): FeaturedPoolRow {
  return {
    igdb_id: c.igdb_id,
    name: c.name,
    slug: c.slug,
    cover_url: c.cover_url ?? null,
    background_url: c.background_url ?? '',
    title_logo_url: c.title_logo_url ?? '',
    blurb: c.blurb ?? '',
    rating_value: c.rating.value,
    rating_source: c.rating.source,
    hltb_value: c.hltb.value,
    hltb_label: c.hltb.label,
    refreshed_at: refreshedAt,
  };
}

function rowToCard(r: FeaturedPoolRow): FeaturedCard {
  return {
    igdb_id: r.igdb_id,
    name: r.name,
    slug: r.slug,
    cover_url: r.cover_url,
    background_url: r.background_url,
    title_logo_url: r.title_logo_url,
    blurb: r.blurb,
    rating: { value: r.rating_value, source: r.rating_source },
    hltb: { value: r.hltb_value, label: r.hltb_label },
    platforms: DEFAULT_PLATFORMS,
    extra_platform_count: 0,
  };
}

// Build in concurrency-limited chunks so we don't melt IGDB on refresh.
async function buildInChunks(ids: number[]): Promise<FeaturedCard[]> {
  const out: FeaturedCard[] = [];
  for (let i = 0; i < ids.length; i += BUILD_CONCURRENCY) {
    const chunk = ids.slice(i, i + BUILD_CONCURRENCY);
    const cards = await buildFeaturedCardsForIds(chunk);
    out.push(...cards);
  }
  return out;
}

export async function refreshFeaturedPool(): Promise<void> {
  const t0 = Date.now();
  console.log('[featured-pool] refresh started…');

  const ids = await fetchRandomPoolIds(TARGET_POOL_SIZE);
  if (ids.length === 0) {
    console.warn('[featured-pool] no ids returned from IGDB — skipping');
    return;
  }

  const cards = await buildInChunks(ids);
  if (cards.length === 0) {
    console.warn('[featured-pool] built 0 cards — skipping write');
    return;
  }

  const refreshedAt = new Date().toISOString();
  const rows = cards.map((c) => cardToRow(c, refreshedAt));

  const { error: upsertErr } = await supabaseAdmin
    .from('featured_pool')
    .upsert(rows, { onConflict: 'igdb_id' });
  if (upsertErr) throw upsertErr;

  // Drop anything not in the current batch (yesterday's leftovers).
  const { error: deleteErr } = await supabaseAdmin
    .from('featured_pool')
    .delete()
    .lt('refreshed_at', refreshedAt);
  if (deleteErr) throw deleteErr;

  console.log(`[featured-pool] refresh complete — ${rows.length} cards in ${Date.now() - t0}ms`);
}

export async function getRandomFromPool(count: number): Promise<FeaturedCard[]> {
  const { data, error } = await supabaseAdmin
    .from('featured_pool')
    .select('*');
  if (error) {
    console.warn('[featured-pool] fetch failed:', error.message);
    return [];
  }
  if (!data || !Array.isArray(data) || data.length === 0) return [];
  const rows = data as FeaturedPoolRow[];
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.slice(0, count).map(rowToCard);
}

// Check if a fresh refresh is needed (≥6h since the last one, or table empty).
async function needsRefresh(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('featured_pool')
    .select('refreshed_at')
    .order('refreshed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return true;
  const age = Date.now() - new Date(data.refreshed_at).getTime();
  return age >= REFRESH_INTERVAL_MS;
}

// Kick off a refresh now (if stale) and schedule subsequent ones every 6h.
// Designed to never throw — failures are logged so the API process stays up.
export function startFeaturedPoolRefreshLoop(): void {
  let firstRun = true;
  const tick = async () => {
    try {
      // Force a refresh on first boot so pool-source changes (e.g. switching
      // from rated→popular) take effect immediately, then fall back to the
      // normal staleness check on subsequent ticks.
      if (firstRun || (await needsRefresh())) await refreshFeaturedPool();
      else console.log('[featured-pool] still fresh — skipping refresh this tick');
    } catch (err) {
      console.warn('[featured-pool] refresh failed:', (err as Error).message);
    } finally {
      firstRun = false;
    }
  };
  void tick();
  setInterval(() => void tick(), REFRESH_INTERVAL_MS).unref();
}
