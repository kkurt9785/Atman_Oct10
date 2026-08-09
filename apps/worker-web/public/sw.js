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
  const target = data.type === 'chat' && data.applicationId
    ? `/chat/${data.applicationId}`
    : data.type === 'accepted' && data.applicationId
      ? '/applications'
      : '/shifts';
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
