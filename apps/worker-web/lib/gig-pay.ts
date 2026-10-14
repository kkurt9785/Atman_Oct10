// 초대 근무 지급 명세 — 사장님 앱(apps/admin-web/lib/pay-statement.ts)과 같은 문장을 만든다. 바꾸면 양쪽 같이.
export type PayoutStatement = {
  facilityName: string; workerName: string; periodStart: string; periodEnd: string;
  workedDays: number; workedMinutes: number; payBasis: string; payRate: number;
  amount: number; withholdingAmount: number; netAmount: number;
  status: 'scheduled' | 'paid' | 'cancelled'; payAt: string | null; paidAt: string | null;
};

export const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
export const hoursText = (minutes: number) => `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;
export const periodText = (start: string, end: string) => (start === end ? start : `${start} ~ ${end}`);

// 실제 기록한 휴게만 차감한다. 양쪽 앱과 지급 계산의 공용 규칙.
export { effectiveBreakMinutes, summarizeAttendancePeriod, payoutDateKST } from './shared/gig-pay/calculation';

export function statementText(s: PayoutStatement) {
  const basis = s.payBasis === 'hourly' ? `시급 ${won(s.payRate)} × ${hoursText(s.workedMinutes)}`
    : s.payBasis === 'daily' ? `일급 ${won(s.payRate)} × ${s.workedDays}일`
    : `월 정액 ${won(s.payRate)}`;
  const when = s.status === 'paid' ? `${(s.paidAt ?? s.payAt ?? '').slice(0, 10)} 지급 완료` : `${s.payAt ?? ''} 지급 예정`;
  return [
    `[잇닿 지급 명세] ${s.facilityName}`,
    `근무자: ${s.workerName}`,
    `기간: ${periodText(s.periodStart, s.periodEnd)} (${s.workedDays}일 · ${hoursText(s.workedMinutes)})`,
    `${basis} = 세전 ${won(s.amount)}`,
    s.withholdingAmount > 0 ? `공제: 사업소득 3.3% −${won(s.withholdingAmount)}` : '공제: 없음',
    `실지급: ${won(s.netAmount)} (${when})`,
    '잇닿(itdot.co.kr)에 기록된 출퇴근으로 계산했어요.',
  ].join('\n');
}

// 공유 시트가 있으면 공유, 없으면 복사. 돌려주는 문구를 화면에 잠깐 보여 준다
export async function sharePayoutStatement(s: PayoutStatement): Promise<string> {
  const text = statementText(s);
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ title: '잇닿 지급 명세', text }); return ''; } catch { return ''; }
  }
  try { await navigator.clipboard.writeText(text); return '명세를 복사했어요'; } catch { return '복사하지 못했어요'; }
}

// 주휴수당(근로기준법 §55): 주 소정근로 15시간 이상 + 개근이면 1일분 유급. 환산 (주 소정/40)×8×시급.
// packages/wage-engine calcWeeklyHolidayPay 와 같은 식 — 화면 안내용 '약' 금액이고, 지급액에 자동으로 더하지는 않는다
export const WEEKLY_HOLIDAY_MIN_MINUTES = 15 * 60;
export function weeklyHolidayPay(weeklyMinutes: number, hourlyWage: number): number {
  if (weeklyMinutes < WEEKLY_HOLIDAY_MIN_MINUTES || hourlyWage <= 0) return 0;
  const paidHours = (Math.min(weeklyMinutes, 40 * 60) / (40 * 60)) * 8;
  return Math.round(paidHours * hourlyWage);
}
// 이번 주(월~일, KST) 범위
export function currentWeekRangeKST(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay() || 7; // 월=1 … 일=7
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - (day - 1)));
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}
