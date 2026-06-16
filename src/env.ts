import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  ASTRO_ORIGIN: process.env.ASTRO_ORIGIN ?? 'http://localhost:4321',
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_SECRET_KEY: required('SUPABASE_SECRET_KEY'),
  IGDB_CLIENT_ID: required('IGDB_CLIENT_ID'),
  IGDB_CLIENT_SECRET: required('IGDB_CLIENT_SECRET'),
  GAMES_CACHE_TTL_HOURS: Number(process.env.GAMES_CACHE_TTL_HOURS ?? 168),
};
