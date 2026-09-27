self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title, body, data } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      data,
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const requestedTarget = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')
    ? data.url
    : null;
  const target = requestedTarget ?? (data.type === 'chat' && data.applicationId
    ? `/chat/${data.applicationId}`
    : data.type === 'accepted' && data.applicationId
      ? '/applications'
      : '/shifts');
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
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
