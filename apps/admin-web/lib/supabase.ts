import { createClient } from '@supabase/supabase-js';

// Server-side only — service_role bypasses RLS.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
export function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}


export function bearerToken(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length);
}

export async function getUserFromBearer(headers: Headers) {
  const token = bearerToken(headers);
  return getUserFromToken(token);
}

export async function getUserFromToken(token: string | null | undefined) {
  const sb = adminClient();
  if (!token || !sb) return null;

  const { data, error } = await sb.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}
