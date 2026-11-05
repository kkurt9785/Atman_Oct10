// 긱 지급 '정산 기간 끝'과 일괄 지급 대상 판정 (2026-11-05, 단기근로 점검 기능 6).
// 지급은 근태 ID로 이전 지급분을 빼므로, 끝 날짜까지만 묶어도 그 뒤 근무는 다음 지급에 그대로 남는다.
// 순수 함수만 둔다: 화면·서버 액션·scripts/qa-gig-pay-period.mjs 가 같이 쓴다.

export const PAY_UNTIL_FLOOR = '2020-01-01';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayKST(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(date: string, delta: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 지난주(월~일)의 일요일. 오늘이 일요일이어도 이번 주는 아직 끝나지 않았으니 그 전 주 일요일이다. */
export function lastWeekSunday(today: string) {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일 … 6=토
  const fromMonday = (dow + 6) % 7;
  return addDays(today, -fromMonday - 1);
}

/** 주소의 ?until= 을 믿을 수 있는 날짜로. 형식이 틀리거나 오늘 이후·너무 옛날이면 오늘. */
export function resolvePayUntil(raw: string | null | undefined, today: string) {
  const value = (raw ?? '').trim();
  // Date rolls 2026-02-30 over to March instead of failing, so compare the round trip.
  if (!DATE.test(value)) return today;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return today;
  if (value > today || value < PAY_UNTIL_FLOOR) return today;
  return value;
}

/** 서버 액션용: 고른 날짜가 이상하면 조용히 바꾸지 않고 거절한다. */
export function assertPayUntil(raw: string, today: string) {
  if (!raw) return today;
  if (resolvePayUntil(raw, today) !== raw) throw new Error('정산 기간 끝 날짜를 다시 골라 주세요. 오늘이나 그 이전 날짜만 고를 수 있어요.');
  return raw;
}

export function periodChips(today: string) {
  const chips = [
    { label: '오늘까지', until: today },
    { label: '어제까지', until: addDays(today, -1) },
    { label: '지난주까지', until: lastWeekSunday(today) },
  ];
  return chips.filter((chip, index) => chips.findIndex((other) => other.until === chip.until) === index);
}

export function untilLabel(until: string, today: string) {
  if (until === today) return '오늘';
  const [, m, d] = until.split('-').map(Number);
  return `${m}월 ${d}일`;
}

export type PayableRow = {
  payBasis: string | null; payRate: number | null; accountNumber: string | null;
  unpaidAmount: number; unpaidDays: number;
};

/** 근무자별 '이체 완료 기록' 버튼을 막는 조건과 같은 규칙. 하나라도 걸리면 일괄 지급에서 뺀다. */
export function payoutBlocker(row: PayableRow): string | null {
  if (!row.payBasis || !row.payRate) return '급여 기준 미설정';
  if (row.payBasis === 'monthly') return '월급 근무자는 따로 검토';
  if (row.unpaidDays <= 0) return '이 기간에 지급할 근무 없음';
  if (!row.accountNumber) return '지급 계좌 전달 대기';
  if (row.unpaidAmount <= 0) return '지급액 0원 · 출퇴근·휴게 확인';
  return null;
}
