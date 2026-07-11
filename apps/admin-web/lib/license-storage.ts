
import type { SupabaseClient } from '@supabase/supabase-js';

const PUBLIC_MARKER = '/storage/v1/object/public/license-photos/';

export function normalizeLicenseObjectPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const markerIndex = trimmed.indexOf(PUBLIC_MARKER);
  if (markerIndex >= 0) {
    return decodeURIComponent(trimmed.slice(markerIndex + PUBLIC_MARKER.length));
  }
  if (/^https?:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/^\/+/, '');
}

export async function createLicenseSignedUrl(
  sb: SupabaseClient,
  value: string | null | undefined,
  expiresInSeconds = 300,
): Promise<string | null> {
  const path = normalizeLicenseObjectPath(value);
  if (!path) return null;
  const { data, error } = await sb.storage
    .from('license-photos')
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
