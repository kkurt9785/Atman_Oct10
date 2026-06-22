// ============================================================================
// payroll — 기간 단위 임금명세서·임금대장 생성기 (엔진 B 결합 + 주40h 연장 보완)
//   · 임금대장: 근로일별 연장·야간·휴일 시간 (2026 의무)
//   · 임금명세서: 항목 분해 (포괄임금 금지 대응)
//   · 주 40시간 초과 연장: 엔진(일 8h)의 보완 — 주 단위 추가 집계
// ============================================================================
import {
  calcShiftWage, calcWeeklyHolidayPay, RULESET_2026,
  type WageRuleset, type OrgPolicy, type ShiftInput,
} from './index.ts';

export interface PayrollShift extends ShiftInput {
  shiftId?: string;
}

export interface PayslipInput {
  attendances: PayrollShift[];     // 기간 내 모든 시프트(출퇴근)
  hourlyWage: number;
  org: OrgPolicy;
  weeklyContractedHours: number;   // 주휴 계산용 소정근로
  perfectAttendanceWeeks: number;  // 개근하여 주휴 발생한 주 수
}

export interface LedgerRow {
  workDate: string;
  workedMinutes: number;
  overtimeMinutes: number;   // 일 8h 초과 (대장 표기용)
  nightMinutes: number;
  holidayMinutes: number;
  dayGross: number;
}

export interface Payslip {
  rows: LedgerRow[];                 // = 임금대장
  totalWorkedMinutes: number;
  totalOvertimeMinutes: number;      // 일 OT + 주 40h 초과 OT
  totalNightMinutes: number;
  totalHolidayMinutes: number;
  basePay: number;
  overtimePay: number;               // 연장 가산 합(일+주)
  nightPay: number;                  // 야간 가산 합
  holidayPay: number;                // 휴일 가산 합
  weeklyHolidayPay: number;          // 주휴수당
  grossPay: number;
  incomeTax: number;                 // 3.0%
  localTax: number;                  // 소득세의 10% (= 0.3%)
  netPay: number;
  ruleVersion: string;
}

const won = (n: number) => Math.round(n);

/** 해당 날짜가 속한 주의 월요일(YYYY-MM-DD) */
function weekKey(dateStr: string): string {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const mondayOffset = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - mondayOffset);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function generatePayslip(input: PayslipInput, r: WageRuleset = RULESET_2026): Payslip {
  const { attendances, hourlyWage, org, weeklyContractedHours, perfectAttendanceWeeks } = input;
  const perMin = hourlyWage / 60;
  const premiumApplies = org.is5Plus || !!org.payPremiumByContract;

  const rows: LedgerRow[] = [];
  let basePay = 0, overtimePay = 0, nightPay = 0, holidayPay = 0;
  let totalWorked = 0, totalDailyOT = 0, totalNight = 0, totalHoliday = 0;

  // 주별 집계(주 40h 초과 연장 보완용)
  const week: Record<string, { worked: number; dailyOT: number }> = {};

  for (const s of attendances) {
    const w = calcShiftWage(s, hourlyWage, org, r);
    const workDate = s.startAt.slice(0, 10);
    rows.push({
      workDate,
      workedMinutes: w.workedMinutes,
      overtimeMinutes: w.overtimeMinutes,
      nightMinutes: w.nightMinutes,
      holidayMinutes: s.isHoliday ? w.workedMinutes : 0,
      dayGross: w.gross,
    });
    basePay += w.base;
    overtimePay += w.overtimePremium;
    nightPay += w.nightPremium;
    holidayPay += w.holidayPremium;
    totalWorked += w.workedMinutes;
    totalDailyOT += w.overtimeMinutes;
    totalNight += w.nightMinutes;
    if (s.isHoliday) totalHoliday += w.workedMinutes;

    const k = weekKey(s.startAt);
    (week[k] ??= { worked: 0, dailyOT: 0 });
    week[k].worked += w.workedMinutes;
    week[k].dailyOT += w.overtimeMinutes;
  }

  // 주 40h 초과 연장 (일 OT로 이미 센 부분 제외, 중복 방지)
  let weeklyOTminutes = 0;
  if (premiumApplies) {
    const cap = r.fullTimeWeeklyHours * 60;
    for (const k of Object.keys(week)) {
      const { worked, dailyOT } = week[k];
      const extra = Math.max(0, (worked - dailyOT) - cap);
      weeklyOTminutes += extra;
    }
    overtimePay += won(weeklyOTminutes * perMin * r.overtimeRate);
  }

  const weeklyHolidayPay = perfectAttendanceWeeks * calcWeeklyHolidayPay(weeklyContractedHours, true, hourlyWage, r);

  const grossPay = won(basePay + overtimePay + nightPay + holidayPay + weeklyHolidayPay);
  const incomeTax = won(grossPay * 0.03);
  const localTax = won(incomeTax * 0.1);
  const netPay = grossPay - incomeTax - localTax;

  return {
    rows,
    totalWorkedMinutes: totalWorked,
    totalOvertimeMinutes: totalDailyOT + weeklyOTminutes,
    totalNightMinutes: totalNight,
    totalHolidayMinutes: totalHoliday,
    basePay: won(basePay), overtimePay: won(overtimePay), nightPay: won(nightPay),
    holidayPay: won(holidayPay), weeklyHolidayPay,
    grossPay, incomeTax, localTax, netPay,
    ruleVersion: r.version,
  };
}
