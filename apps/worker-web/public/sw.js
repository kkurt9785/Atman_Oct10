self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = {}; }
  const { title = '잇닿 알림', body = '새 알림을 앱에서 확인해 주세요.', data = {} } = payload || {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      data,
      tag: typeof data?.notificationId === 'string' ? data.notificationId : undefined,
      vibrate: [200, 100, 200],
    })
  );
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
  const data = event.notification.data || {};
  const requestedTarget = safeNotificationPath(data.url);
  const target = requestedTarget ?? (data.type === 'chat' && data.applicationId
    ? `/chat/${encodeURIComponent(data.applicationId)}`
    : data.type === 'accepted' && data.applicationId
      ? '/applications'
      : '/shifts');
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
            if ('navigate' in client) return client.navigate(target).then(() => client.focus());
            return client.focus();
          }
        }
        return clients.openWindow(target);
      })
  );
});

// 설치 요건용 fetch 핸들러. 페이지 이동 요청만 네트워크로 그대로 넘긴다(캐시 없음) — 크롬이 '홈 화면에 추가'를 띄우려면 fetch 핸들러가 있어야 한다.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request));
});
