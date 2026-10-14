// 잇닿 관리자 — PWA 설치용 최소 서비스 워커.
// 오프라인 캐싱은 하지 않는다 (근태·급여 데이터는 항상 최신이어야 함).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
// 설치 가능 조건을 안정적으로 충족하되, 운영 데이터는 캐시하지 않고 네트워크로 전달한다.
self.addEventListener('fetch', () => {});
self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json?.() ?? {}; } catch { payload = {}; }
  payload = payload || {};
  event.waitUntil(self.registration.showNotification(payload.title ?? '잇닿 근태 알림', {
    body: payload.body ?? '확인할 근태 기록이 있어요.',
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    data: payload.data ?? { url: '/timesheet' },
    tag: typeof payload.data?.notificationId === 'string' ? payload.data.notificationId : undefined,
  }));
});
function safeNotificationPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value, self.location.origin);
    return parsed.origin === self.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch { return null; }
}
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(safeNotificationPath(event.notification.data?.url) ?? '/timesheet', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    return existing ? existing.focus().then(() => existing.navigate(url)) : clients.openWindow(url);
  }));
});
