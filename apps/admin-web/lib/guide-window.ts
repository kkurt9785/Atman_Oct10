// 베타 기간 사용 안내(처음 쓰는 사람에게 화면 위에 뜨는 카드)가 보이는 기간.
// 2026-11-11 사용자 결정: 체험(베타) 기간 동안만 보이고 지나면 사라진다. 닫으면 그 화면에서는 다시 안 뜬다.
// 관리자: 체험 종료일과 "사업장 등록 후 30일" 중 늦은 날까지. 시연 사업장은 기간이 없다(닫기만 가능).
// 근무자 앱 쪽 규칙은 apps/worker-web/lib/guide-window.ts
export const ADMIN_GUIDE_DAYS = 30;
export const GUIDE_KEY_PREFIX = 'itdot-guide:';
export const guideKey = (id: string) => `${GUIDE_KEY_PREFIX}${id}`;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);

/** 관리자 안내가 보이는 마지막 날(YYYY-MM-DD). 알 수 없으면 null — 안내를 띄우지 않는다. */
export function adminGuideLastDay(input: { isDemo?: boolean; trialEndsAt?: string | null; createdAt?: string | null }): string | null {
  if (input.isDemo) return '9999-12-31';
  const days: string[] = [];
  if (input.trialEndsAt && /^\d{4}-\d{2}-\d{2}/.test(input.trialEndsAt)) days.push(input.trialEndsAt.slice(0, 10));
  if (input.createdAt && Number.isFinite(Date.parse(input.createdAt))) days.push(addDays(kstDay(input.createdAt), ADMIN_GUIDE_DAYS));
  return days.length ? days.sort()[days.length - 1] : null;
}

export function guideOpenOn(today: string, lastDay: string | null): boolean {
  return Boolean(lastDay) && today <= (lastDay as string);
}
