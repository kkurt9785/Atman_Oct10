// 잇닿 사장님 — PWA 설치용 최소 서비스 워커.
// 오프라인 캐싱은 하지 않는다 (근태·급여 데이터는 항상 최신이어야 함).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
