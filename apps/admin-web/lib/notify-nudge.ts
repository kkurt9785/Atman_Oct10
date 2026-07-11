// Hobby 플랜 cron이 일 1회뿐이라, 알림을 만든 액션이 직후에 발송 라우트를
// 직접 깨운다 (fire-and-forget). cron은 실패분 재시도용 스위퍼로만 동작.
// Pro 전환 시 vercel.json cron을 */5로 되돌리면 이 nudge는 보조 수단이 된다.
export function nudgeNotificationDispatch(): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3002';
  fetch(`${base}/api/cron/dispatch-notifications`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
    cache: 'no-store',
  }).catch(() => undefined);
}
