// Items handed over by the service worker after an Android share-sheet POST to /share.
export const SHARE_CACHE = 'haraguri-share';
export type SharedItems = { files: File[]; text: string };

export function sharedFlag(search: string): 'ok' | 'unsupported' | 'error' | null {
  const value = new URLSearchParams(search).get('shared');
  return value === '1' ? 'ok' : value === 'unsupported' || value === 'error' ? value : null;
}

export async function takeSharedItems(): Promise<SharedItems | null> {
  if (typeof caches === 'undefined') return null;
  const cache = await caches.open(SHARE_CACHE);
  const metaResponse = await cache.match('/share/meta');
  if (!metaResponse) return null;
  const meta = await metaResponse.json() as { count: number; text: string; at: number };
  const files: File[] = [];
  for (let i = 0; i < meta.count; i++) {
    const r = await cache.match(`/share/file/${i}`);
    if (!r) continue;
    const name = decodeURIComponent(r.headers.get('X-File-Name') || `shared-${i}`);
    files.push(new File([await r.blob()], name, { type: r.headers.get('Content-Type') || 'application/octet-stream' }));
  }
  await Promise.all((await cache.keys()).map(k => cache.delete(k)));
  // Stale hand-offs (older than 10 minutes) are dropped rather than surprising the user later.
  if (Date.now() - meta.at > 10 * 60 * 1000) return null;
  return { files, text: meta.text || '' };
}
