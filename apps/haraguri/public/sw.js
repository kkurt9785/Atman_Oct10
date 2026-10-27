// Never cache family data, auth responses or uploaded files on a shared device.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HARAGURI</title><body style="font-family:system-ui;padding:40px;background:#f7f6f2"><h1>잠시 연결이 끊겼어요.</h1><p>가족의 최신 기록을 보려면 인터넷 연결이 필요해요.</p><button onclick="location.reload()">다시 연결</button></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});
