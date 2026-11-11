// 베타 기간 사용 안내(처음 쓰는 사람에게 화면 위에 뜨는 카드) — 근무자 앱.
// 2026-11-11 사용자 결정: 일정 기간이 지나면 사라진다. 근무자는 그 안내를 처음 본 날부터 14일.
// 기록은 이 폰(브라우저)에만 남긴다 — 서버 기록·DB 변경 없음. 닫으면 그 화면에서는 다시 안 뜬다.
export const WORKER_GUIDE_DAYS = 14;
export const GUIDE_KEY_PREFIX = 'itdot-guide:';
export const guideKey = (id: string) => `${GUIDE_KEY_PREFIX}${id}`;
export const guideFirstKey = (id: string) => `${GUIDE_KEY_PREFIX}${id}:first`;

/** 처음 본 시각부터 days 일 동안, 닫지 않았으면 보인다. 처음 보는 사람(firstSeenMs=null)에게는 보인다. */
export function workerGuideOpen(nowMs: number, firstSeenMs: number | null, closed: boolean, days = WORKER_GUIDE_DAYS): boolean {
  if (closed) return false;
  if (firstSeenMs === null || !Number.isFinite(firstSeenMs)) return true;
  return nowMs - firstSeenMs < days * 86_400_000;
}
