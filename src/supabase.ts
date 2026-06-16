import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Service-role client: bypasses RLS. Use ONLY on the server, never expose.
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
