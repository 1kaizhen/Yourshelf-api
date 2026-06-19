import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  // Comma-separated list of allowed origins. Defaults cover Astro's port-stepping
  // behavior when 4321/4322 are taken by other dev servers.
  ASTRO_ORIGIN: (process.env.ASTRO_ORIGIN ?? 'http://localhost:4321,http://localhost:4322,http://localhost:4323,http://localhost:4324')
    .split(',').map((s) => s.trim()).filter(Boolean),
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_SECRET_KEY: required('SUPABASE_SECRET_KEY'),
  IGDB_CLIENT_ID: required('IGDB_CLIENT_ID'),
  IGDB_CLIENT_SECRET: required('IGDB_CLIENT_SECRET'),
  STEAMGRIDDB_API_KEY: process.env.STEAMGRIDDB_API_KEY ?? '',
  GAMES_CACHE_TTL_HOURS: Number(process.env.GAMES_CACHE_TTL_HOURS ?? 168),
};
