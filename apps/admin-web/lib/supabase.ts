import { createClient } from '@supabase/supabase-js';

// Server-side only — service_role bypasses RLS.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
export function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const ORG_ID = process.env.ORG_ID ?? null;
