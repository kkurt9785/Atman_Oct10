// payroll 테스트 — node --experimental-strip-types src/payroll.test.ts
import assert from 'node:assert';
import { generatePayslip, type PayslipInput } from './payroll.ts';

const W = 12000;
let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log('  ✅', name); }
  catch (e) { fail++; console.log('  ❌', name, '\n     ', (e as Error).message); }
}

// 1) 주 40h 초과 연장 보완: 6일 × 7h = 42h (일 OT 없음) → 주 OT 2h
t('주 40h 초과 → 주간 연장 2h', () => {
  // 2026-07-06(월)~07-11(토), 각 09:00-16:00 휴게0 = 7h
  const days = ['06','07','08','09','10','11'];
  const att = days.map(d => ({ startAt: `2026-07-${d}T09:00:00`, endAt: `2026-07-${d}T16:00:00`, breakMinutes: 0 }));
  const ps = generatePayslip({ attendances: att, hourlyWage: W, org: { is5Plus: true }, weeklyContractedHours: 40, perfectAttendanceWeeks: 0 });
  assert.equal(ps.totalWorkedMinutes, 42 * 60);
  assert.equal(ps.totalOvertimeMinutes, 2 * 60);        // 주 40h 초과분
  assert.equal(ps.basePay, 42 * W);                     // 504,000
  assert.equal(ps.overtimePay, won(2 * W * 0.5));       // 12,000
});

// 2) 일 8h 초과(일 OT) — 주 40h 미만이면 주 OT 추가 없음
t('일 OT만 (11h 1일)', () => {
  const att = [{ startAt: '2026-07-06T09:00:00', endAt: '2026-07-06T21:00:00' }]; // 휴게60→11h
  const ps = generatePayslip({ attendances: att, hourlyWage: W, org: { is5Plus: true }, weeklyContractedHours: 20, perfectAttendanceWeeks: 0 });
  assert.equal(ps.totalOvertimeMinutes, 3 * 60);        // 일 8h 초과 3h
  assert.equal(ps.overtimePay, won(3 * W * 0.5));       // 18,000
});

// 3) 5인 미만 — 가산 0 (주 OT도 0)
t('5인 미만 — 가산 0', () => {
  const days = ['06','07','08','09','10','11'];
  const att = days.map(d => ({ startAt: `2026-07-${d}T09:00:00`, endAt: `2026-07-${d}T16:00:00`, breakMinutes: 0 }));
  const ps = generatePayslip({ attendances: att, hourlyWage: W, org: { is5Plus: false }, weeklyContractedHours: 40, perfectAttendanceWeeks: 0 });
  assert.equal(ps.overtimePay, 0);
  assert.equal(ps.grossPay, 42 * W);
});

// 4) 주휴수당 포함 + 세금(3.3%)
t('주휴 + 3.3% 세금', () => {
  const days = ['06','07','08','09','10','11'];
  const att = days.map(d => ({ startAt: `2026-07-${d}T09:00:00`, endAt: `2026-07-${d}T16:00:00`, breakMinutes: 0 }));
  const ps = generatePayslip({ attendances: att, hourlyWage: W, org: { is5Plus: true }, weeklyContractedHours: 40, perfectAttendanceWeeks: 1 });
  assert.equal(ps.weeklyHolidayPay, 8 * W);             // 96,000
  // gross = base504000 + OT12000 + 주휴96000 = 612000
  assert.equal(ps.grossPay, 612000);
  assert.equal(ps.incomeTax, won(612000 * 0.03));       // 18,360
  assert.equal(ps.localTax, won(18360 * 0.1));          // 1,836
  assert.equal(ps.netPay, 612000 - 18360 - 1836);       // 591,804
});

// 5) 임금대장 행 = 근로일 수, 항목 보존
t('임금대장 행 생성', () => {
  const att = [
    { startAt: '2026-07-06T22:00:00', endAt: '2026-07-07T06:00:00' },         // 철야
    { startAt: '2026-07-08T09:00:00', endAt: '2026-07-08T18:00:00', isHoliday: true },
  ];
  const ps = generatePayslip({ attendances: att, hourlyWage: W, org: { is5Plus: true }, weeklyContractedHours: 16, perfectAttendanceWeeks: 0 });
  assert.equal(ps.rows.length, 2);
  assert.ok(ps.rows[0].nightMinutes > 0);               // 철야 야간 기재
  assert.ok(ps.rows[1].holidayMinutes > 0);             // 휴일 시간 기재
});

function won(n: number) { return Math.round(n); }
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
