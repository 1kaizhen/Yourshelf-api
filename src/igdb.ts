import { env } from './env.js';

type Token = { accessToken: string; expiresAt: number };
let cached: Token | null = null;
let inflight: Promise<Token> | null = null;

async function fetchToken(): Promise<Token> {
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', env.IGDB_CLIENT_ID);
  url.searchParams.set('client_secret', env.IGDB_CLIENT_SECRET);
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Twitch token request failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh 60s before actual expiry.
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  };
}

async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  if (!inflight) {
    inflight = fetchToken().finally(() => { inflight = null; });
  }
  cached = await inflight;
  return cached.accessToken;
}

export async function igdbRequest<T>(endpoint: string, body: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
      Accept: 'application/json',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`IGDB ${endpoint} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}
