import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

function serverUrl(): string | null {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
}

function publicKey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
}

// Trusted server-only client. This bypasses RLS and must only be used after an
// authenticated/authorized context has been established, or for provider webhooks.
export function adminClient(): SupabaseClient | null {
  const url = serverUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// User-scoped server client. RPC/RLS sees the caller's JWT and auth.uid().
export function userClient(accessToken: string): SupabaseClient | null {
  const url = serverUrl();
  const key = publicKey();
  if (!url || !key || !accessToken) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

export function bearerToken(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim() || null;
}

export async function getUserFromBearer(headers: Headers): Promise<User | null> {
  return getUserFromToken(bearerToken(headers));
}

export async function getUserFromToken(token: string | null | undefined): Promise<User | null> {
  const sb = adminClient();
  if (!token || !sb) return null;

  const { data, error } = await sb.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}
