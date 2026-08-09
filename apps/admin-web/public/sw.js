// 잇닿 사장님 — PWA 설치용 최소 서비스 워커.
// 오프라인 캐싱은 하지 않는다 (근태·급여 데이터는 항상 최신이어야 함).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
self.addEventListener('push', (event) => {
  const payload = event.data?.json?.() ?? {};
  event.waitUntil(self.registration.showNotification(payload.title ?? '잇닿 근태 알림', {
    body: payload.body ?? '확인할 근태 기록이 있어요.',
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    data: payload.data ?? { url: '/timesheet' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/timesheet', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    return existing ? existing.focus().then(() => existing.navigate(url)) : clients.openWindow(url);
  }));
});
