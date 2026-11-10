import { summarizeAttendancePeriod, type RecordedAttendance } from '@/lib/shared/gig-pay/calculation';
import { roundPay } from '@/lib/shared/gig-pay/shift-pay';

// 직원(월급·시급·일급)의 '이번 달 예상 급여(세전)'.
// 사장님 급여 화면(admin-web lib/db/payroll.ts getStaffWagePayments)과 같은 식을 쓴다:
//   월급 = 약정 금액 그대로 · 일급 = 완료 근무일 × 일급 · 시급 = 완료 근태 분 × 시급 ÷ 60 (원 단위 반올림)
//   근태는 status='completed' 만 센다. 퇴근까지 찍혔지만 완료가 아닌 기록(승인 대기 등)은 건수만 알린다.
// 근무자는 자기 facility_staff·staff_attendances 행만 읽을 수 있고(RLS), 사업장이 저장한 급여 확정본(staff_wage_payments)은 못 읽는다.
// 그래서 여기 금액은 언제나 '예상'이다 — 확정 금액과 공제는 사업장이 월 마감 뒤에 정한다.
export type StaffPayTerms = {
  pay_basis: string | null;
  pay_rate: number | string | null;
  contract_start?: string | null;
  contract_end?: string | null;
};
export type StaffPayAttendance = RecordedAttendance;
export type StaffPayBasis = 'monthly' | 'hourly' | 'daily';
export type StaffPayEstimate = {
  // 급여 조건(기준·금액)이 아직 없으면 금액을 지어내지 않는다
  status: 'ready' | 'config_required';
  basis: StaffPayBasis | null;
  rate: number | null;
  minutes: number;
  days: number;
  amount: number;
  // 퇴근까지 찍혔는데 아직 확정되지 않아 금액에서 빠진 기록 수
  pendingCount: number;
  // 월급인데 이번 달 중간에 입사·퇴사 — 사업장이 날짜에 맞춰 다시 계산할 수 있다
  needsProration: boolean;
};

const BASES: readonly StaffPayBasis[] = ['monthly', 'hourly', 'daily'];

/** 이번 달(KST)의 첫날·끝날·표시용 '11월' */
export function payMonthKST(now: Date = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const month = kst.toISOString().slice(0, 7);
  const periodMonth = `${month}-01`;
  const next = new Date(`${periodMonth}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const endDate = new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
  return { month, periodMonth, endDate, label: `${Number(month.slice(5))}월` };
}

export function estimateStaffPay(terms: StaffPayTerms, attendances: StaffPayAttendance[], periodMonth: string, endDate: string): StaffPayEstimate {
  const inMonth = attendances.filter((row) => row.work_date >= periodMonth && row.work_date <= endDate);
  const work = summarizeAttendancePeriod(inMonth, periodMonth, endDate);
  const pendingCount = inMonth.filter((row) => row.status !== 'completed' && Boolean(row.check_out_at)).length;
  const basis = BASES.includes(terms.pay_basis as StaffPayBasis) ? (terms.pay_basis as StaffPayBasis) : null;
  const numericRate = Number(terms.pay_rate);
  const rate = Number.isFinite(numericRate) && numericRate > 0 ? numericRate : null;
  const startsMidMonth = Boolean(terms.contract_start && terms.contract_start > periodMonth && terms.contract_start <= endDate);
  const endsMidMonth = Boolean(terms.contract_end && terms.contract_end >= periodMonth && terms.contract_end < endDate);
  const base = { basis, rate, minutes: work.minutes, days: work.days, pendingCount, needsProration: basis === 'monthly' && (startsMidMonth || endsMidMonth) };
  if (!basis || !rate) return { ...base, status: 'config_required', amount: 0 };
  const amount = basis === 'monthly' ? rate : basis === 'daily' ? work.days * rate : roundPay(work.minutes, rate);
  return { ...base, status: 'ready', amount };
}

/** 근무 분 → '169시간 40분' */
export function workedTimeLabel(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60), rest = total % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

/** 계산 근거 한 줄 — 화면이 식을 그대로 보여 줘야 직원이 근태와 맞춰 볼 수 있다 */
export function payBasisLine(estimate: StaffPayEstimate) {
  if (estimate.status !== 'ready' || !estimate.rate) return '';
  const won = `${estimate.rate.toLocaleString('ko-KR')}원`;
  if (estimate.basis === 'monthly') return `월급 ${won}`;
  if (estimate.basis === 'daily') return `일급 ${won} × 확정 근무 ${estimate.days}일`;
  return `시급 ${won} × 확정 근무 ${workedTimeLabel(estimate.minutes)}`;
}
