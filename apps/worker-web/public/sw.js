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

// 푸시 알림을 눌렀을 때 열 화면 — 앱 안 알림 목록(lib/notification-destination.ts)과 같은 규칙.
// 서비스워커는 TS 모듈을 읽지 못해 여기 다시 적는다. lib/__tests__/push-destination.test.ts 가 이 파일을 실행해 두 규칙이 같은지 확인한다.
function pickString(data, keys) {
  for (const key of keys) { const value = data[key]; if (typeof value === 'string' && value) return value; }
  return null;
}

function pushKindDestination(data) {
  const type = pickString(data, ['type']) || '';
  const event = pickString(data, ['eventType', 'event_type']) || '';
  const kind = pickString(data, ['kind']) || event;
  const shiftId = pickString(data, ['shiftId', 'shift_id']);
  const applicationId = pickString(data, ['applicationId', 'application_id']);
  const myApplication = applicationId ? `/applications#application-${encodeURIComponent(applicationId)}` : '/applications';
  if (type === 'chat' || event === 'chat.message') return applicationId ? `/chat/${encodeURIComponent(applicationId)}` : '/applications';
  // 반복근무 요청은 data.type 이 새 공고와 같은 new_shift 지만 수락은 '내 근무'에서 한다
  if (event === 'shift.invited') return myApplication;
  if (type === 'new_shift' || type === 'urgent_shift' || event === 'shift.created' || event === 'shift.urgent') return shiftId ? `/shifts?highlight=${encodeURIComponent(shiftId)}` : '/shifts';
  if (type === 'new_shift_batch') return '/shifts';
  if (['shift.cover_requested', 'shift.cover_claim_rejected', 'shift.cover_cancelled'].includes(event)) return '/cover';
  if (type === 'accepted' || type === 'vacancy_invited' || type === 'checkout' || event.startsWith('shift.') || event.startsWith('shift_application.') || event.startsWith('credential.')) return myApplication;
  if (kind.startsWith('attendance.')) return '/workplace';
  return null;
}

function pushDestination(data) {
  const explicit = safeNotificationPath(data.url);
  const fallback = pushKindDestination(data);
  // 목록 주소만 적힌 알림(/shifts, /applications)은 같은 목록 안에서 그 공고·지원을 바로 연다
  if (explicit && fallback && (explicit === '/shifts' || explicit === '/applications') && fallback.startsWith(explicit)) return fallback;
  return explicit || fallback || '/shifts';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = pushDestination(event.notification.data || {});
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
