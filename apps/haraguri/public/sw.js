// Never cache family data, auth responses or uploaded files on a shared device.
// The only stored thing is a share-sheet hand-off: files/text shared from another app wait here until the page picks them up.
const SHARE_CACHE = 'haraguri-share';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share') {
    event.respondWith((async () => {
      try {
        const form = await event.request.formData();
        const cache = await caches.open(SHARE_CACHE);
        const keys = await cache.keys();
        await Promise.all(keys.map(k => cache.delete(k)));
        const files = form.getAll('files').filter(f => typeof f !== 'string' && f.size > 0);
        await Promise.all(files.map((file, i) => cache.put(`/share/file/${i}`, new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || `shared-${i}`) } }))));
        const meta = { count: files.length, text: [form.get('title'), form.get('text'), form.get('url')].filter(v => typeof v === 'string' && v.trim()).join('\n'), at: Date.now() };
        await cache.put('/share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
        return Response.redirect('/?shared=1', 303);
      } catch {
        return Response.redirect('/?shared=error', 303);
      }
    })());
    return;
  }
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HARAGURI</title><body style="font-family:system-ui;padding:40px;background:#f7f6f2"><h1>잠시 연결이 끊겼어요.</h1><p>가족의 최신 기록을 보려면 인터넷 연결이 필요해요.</p><button onclick="location.reload()">다시 연결</button></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});
