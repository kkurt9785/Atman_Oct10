import { after } from 'next/server';

// Hobby 플랜 cron이 일 1회뿐이라 알림 생성 직후 별도 발송 요청을 깨운다.
// 알림은 이미 notification_outbox 에 저장된 뒤라, 이 요청이 늦거나 실패해도 outbox는 그대로 남아 cron이 다시 처리한다.
// 그래서 기본은 응답을 기다리지 않는다 — 화면 응답이 나간 뒤(after) 보내고, 서버리스가 그 요청을 마칠 때까지만 살아 있다.
// (공고 등록이 시연에서 20초 넘게 '등록 중...'에 머물렀다 — 2026-11-05 QA. 발송 결과가 필요한 호출만 wait:true로 기다린다)
export async function nudgeNotificationDispatch(timeoutMs = 1_500, { wait = false }: { wait?: boolean } = {}): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // VERCEL_URL은 *.vercel.app 배포 호스트라 배포 보호(인증 벽)에 막혀 302로 조용히 실패한다(프로덕션 실측).
  // 반드시 공개 도메인으로 보낸다: ADMIN_BASE_URL > VERCEL_PROJECT_PRODUCTION_URL > 로컬.
  const base = process.env.ADMIN_BASE_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3002');
  const send = async () => {
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
  };
  if (!wait) {
    try {
      after(send);
      return true;
    } catch {
      // 요청 밖(스크립트·테스트)에서는 after 를 쓸 수 없다 — 아래에서 짧게 기다린다
    }
  }
  return send();
}
