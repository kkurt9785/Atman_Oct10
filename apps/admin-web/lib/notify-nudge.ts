// Hobby 플랜 cron이 일 1회뿐이라 알림 생성 직후 별도 발송 요청을 깨운다.
// 호출자는 짧은 시간 동안 응답을 기다려 서버리스 응답 종료 전에 요청 전송을
// 보장한다. 시간 초과나 실패 시 outbox는 그대로 남아 cron이 다시 처리한다.
export async function nudgeNotificationDispatch(timeoutMs = 4_000): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3002';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/cron/dispatch-notifications`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
