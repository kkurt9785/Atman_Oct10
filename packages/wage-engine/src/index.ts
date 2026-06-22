// ============================================================================
// wage-engine — 한국 근로기준법 법정수당 계산 엔진 (순수 함수 · 룰 버전드)
//
// 포괄임금 금지(2026.4 지침) 대응: 실근로시간 기준으로 항목별 법정수당 산출.
// 근거: 근로기준법 §54(휴게) §55(주휴) §56(연장·야간·휴일 가산) §11(5인 미만 적용제외)
// 모든 계산은 ruleVersion으로 추적 → 법 개정 시 룰셋만 교체, 과거분은 당시 룰로 재현.
// ============================================================================

// ---------- 룰셋 (법규 = 데이터) ----------
export interface WageRuleset {
  version: string;
  minHourlyWage: number;       // 최저시급(원)
  nightStartHour: number;      // 야간 시작 (22)
  nightEndHour: number;        // 야간 종료 (06)
  dailyRegularMinutes: number; // 1일 소정 상한 (480 = 8h)
  overtimeRate: number;        // 연장 가산율
  nightRate: number;           // 야간 가산율
  holidayWithin8Rate: number;  // 휴일 8h 이내 가산율
  holidayOver8Rate: number;    // 휴일 8h 초과 가산율
  weeklyHolidayMinHours: number; // 주휴 최소 소정근로 (15h)
  fullTimeWeeklyHours: number;   // 주휴 환산 기준 (40h)
}

// 2026년 룰셋 (2026.1.1~12.31). 최저시급 10,320원(고용노동부 고시).
export const RULESET_2026: WageRuleset = {
  version: '2026.1',
  minHourlyWage: 10320,
  nightStartHour: 22,
  nightEndHour: 6,
  dailyRegularMinutes: 8 * 60,
  overtimeRate: 0.5,
  nightRate: 0.5,
  holidayWithin8Rate: 0.5,
  holidayOver8Rate: 1.0,
  weeklyHolidayMinHours: 15,
  fullTimeWeeklyHours: 40,
};

// ---------- 입출력 타입 ----------
export interface ShiftInput {
  startAt: string;          // ISO 8601 (실제 날짜 포함 → 야간/철야 자동 처리)
  endAt: string;            // ISO 8601 (반드시 startAt 이후)
  breakMinutes?: number;    // 휴게(무급). 미입력 시 법정 추정(4h↑30분/8h↑60분)
  isHoliday?: boolean;      // 휴일근로 여부(주휴일·약정휴일·공휴일)
}

export interface OrgPolicy {
  is5Plus: boolean;             // 상시 5인 이상 = 가산수당 의무
  payPremiumByContract?: boolean; // 5인 미만이지만 약정으로 가산 지급
}

export interface ShiftWage {
  totalMinutes: number;     // 체류(휴게 포함)
  breakMinutes: number;     // 휴게(무급 공제)
  workedMinutes: number;    // 실근로
  nightMinutes: number;     // 야간(22-06) 실근로
  overtimeMinutes: number;  // 연장(1일 8h 초과)
  base: number;             // 기본 임금
  overtimePremium: number;  // 연장 가산
  nightPremium: number;     // 야간 가산
  holidayPremium: number;   // 휴일 가산
  gross: number;            // 합계(주휴 제외)
  ruleVersion: string;
  warnings: string[];       // 최저임금 미달 등
}

// ---------- 유틸 ----------
const won = (n: number) => Math.round(n);

/** 두 구간의 겹치는 분(minute) */
function overlapMinutes(aS: number, aE: number, bS: number, bE: number): number {
  return Math.max(0, (Math.min(aE, bE) - Math.max(aS, bS)) / 60000);
}

/** [start,end] 중 야간(매일 22:00~익일 06:00)에 속하는 분 */
export function nightMinutes(start: Date, end: Date, r: WageRuleset = RULESET_2026): number {
  const DAY = 86400000;
  let total = 0;
  const base = new Date(start); base.setHours(0, 0, 0, 0);
  // 전날~다음날 야간 창을 스캔 (창끼리 겹치지 않아 단순 합산 안전)
  for (let t = base.getTime() - DAY; t <= end.getTime() + DAY; t += DAY) {
    const nStart = new Date(t); nStart.setHours(r.nightStartHour, 0, 0, 0);          // 22:00
    const nEnd = new Date(t + DAY); nEnd.setHours(r.nightEndHour, 0, 0, 0);          // 익일 06:00
    total += overlapMinutes(start.getTime(), end.getTime(), nStart.getTime(), nEnd.getTime());
  }
  return Math.round(total);
}

/** 법정 휴게시간 추정 (4h↑ 30분, 8h↑ 60분) — breakMinutes 미입력 시 */
export function legalBreakMinutes(totalMinutes: number): number {
  if (totalMinutes >= 8 * 60) return 60;
  if (totalMinutes >= 4 * 60) return 30;
  return 0;
}

// ---------- 핵심: 시프트 1건 법정수당 ----------
export function calcShiftWage(
  shift: ShiftInput,
  hourlyWage: number,
  org: OrgPolicy,
  r: WageRuleset = RULESET_2026,
): ShiftWage {
  const start = new Date(shift.startAt);
  const end = new Date(shift.endAt);
  const warnings: string[] = [];

  const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (!(totalMinutes > 0)) throw new Error('endAt must be after startAt');

  const breakMinutes = shift.breakMinutes ?? legalBreakMinutes(totalMinutes);
  const workedMinutes = Math.max(0, totalMinutes - breakMinutes);

  // 야간 분 (휴게가 야간에 없다고 가정 → workedMinutes 상한으로 캡)
  const nightMin = Math.min(nightMinutes(start, end, r), workedMinutes);
  const overtimeMinutes = Math.max(0, workedMinutes - r.dailyRegularMinutes);

  if (hourlyWage < r.minHourlyWage) {
    warnings.push(`시급 ${hourlyWage}원이 ${r.version} 최저시급 ${r.minHourlyWage}원 미만`);
  }

  const perMin = hourlyWage / 60;
  const base = won(workedMinutes * perMin);

  // 가산수당: 5인 이상 또는 약정 시에만
  const premiumApplies = org.is5Plus || !!org.payPremiumByContract;
  let overtimePremium = 0, nightPremium = 0, holidayPremium = 0;

  if (premiumApplies) {
    nightPremium = won(nightMin * perMin * r.nightRate);
    if (shift.isHoliday) {
      // 휴일근로: 8h 이내 +50%, 초과 +100% (연장 가산과 중복 X → 초과분이 연장 역할)
      const within8 = Math.min(workedMinutes, r.dailyRegularMinutes);
      const over8 = Math.max(0, workedMinutes - r.dailyRegularMinutes);
      holidayPremium = won(within8 * perMin * r.holidayWithin8Rate + over8 * perMin * r.holidayOver8Rate);
    } else {
      overtimePremium = won(overtimeMinutes * perMin * r.overtimeRate);
    }
  } else if (overtimeMinutes > 0 || nightMin > 0 || shift.isHoliday) {
    warnings.push('5인 미만·무약정 → 연장/야간/휴일 가산 미적용');
  }

  const gross = base + overtimePremium + nightPremium + holidayPremium;
  return {
    totalMinutes, breakMinutes, workedMinutes, nightMinutes: nightMin, overtimeMinutes,
    base, overtimePremium, nightPremium, holidayPremium, gross,
    ruleVersion: r.version, warnings,
  };
}

// ---------- 주휴수당 (§55) ----------
/** 주 소정근로 15h↑ + 개근 → 1일분 유급. 환산: (주 소정/40)*8*시급 */
export function calcWeeklyHolidayPay(
  weeklyContractedHours: number,
  perfectAttendance: boolean,
  hourlyWage: number,
  r: WageRuleset = RULESET_2026,
): number {
  if (!perfectAttendance) return 0;
  if (weeklyContractedHours < r.weeklyHolidayMinHours) return 0;
  const paidHours = Math.min(weeklyContractedHours, r.fullTimeWeeklyHours) / r.fullTimeWeeklyHours * 8;
  return won(paidHours * hourlyWage);
}
