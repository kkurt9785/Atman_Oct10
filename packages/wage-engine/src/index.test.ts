// wage-engine 단위 테스트 — node --experimental-strip-types src/index.test.ts
import assert from 'node:assert';
import { calcShiftWage, calcWeeklyHolidayPay, type OrgPolicy } from './index.ts';

const W = 12000;                 // 시급 (perMin = 200, 계산 검증 쉽게)
const BIG: OrgPolicy = { is5Plus: true };
const SMALL: OrgPolicy = { is5Plus: false };

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log('  ✅', name); }
  catch (e) { fail++; console.log('  ❌', name, '\n     ', (e as Error).message); }
}

// 1) 주간 9-18 (1h 휴게 → 8h) : 기본급만
t('주간 8h — 기본급만', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T09:00:00', endAt: '2026-07-01T18:00:00' }, W, BIG);
  assert.equal(r.workedMinutes, 480);
  assert.equal(r.base, 96000);
  assert.equal(r.overtimePremium, 0);
  assert.equal(r.nightPremium, 0);
  assert.equal(r.gross, 96000);
});

// 2) 철야 22-06 (휴게 60 → 7h, 전부 야간) : 야간 +50%
t('철야 야간 — 야간가산', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T22:00:00', endAt: '2026-07-02T06:00:00' }, W, BIG);
  assert.equal(r.workedMinutes, 420);
  assert.equal(r.nightMinutes, 420);
  assert.equal(r.base, 84000);
  assert.equal(r.nightPremium, 42000);   // 7h*12000*0.5
  assert.equal(r.overtimeMinutes, 0);
  assert.equal(r.gross, 126000);
});

// 3) 연장 09-21 (휴게 60 → 11h) : 연장 3h +50%
t('연장 11h — 연장가산', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T09:00:00', endAt: '2026-07-01T21:00:00' }, W, BIG);
  assert.equal(r.workedMinutes, 660);
  assert.equal(r.overtimeMinutes, 180);
  assert.equal(r.base, 132000);
  assert.equal(r.overtimePremium, 18000); // 3h*12000*0.5
  assert.equal(r.nightPremium, 0);
  assert.equal(r.gross, 150000);
});

// 4) 5인 미만 — 가산 미적용 + 경고
t('5인 미만 — 가산 0', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T09:00:00', endAt: '2026-07-01T21:00:00' }, W, SMALL);
  assert.equal(r.base, 132000);
  assert.equal(r.overtimePremium, 0);
  assert.equal(r.gross, 132000);
  assert.ok(r.warnings.some(w => w.includes('5인 미만')));
});

// 5) 휴일 8h : +50%
t('휴일 8h — 휴일가산 50%', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T09:00:00', endAt: '2026-07-01T18:00:00', isHoliday: true }, W, BIG);
  assert.equal(r.workedMinutes, 480);
  assert.equal(r.holidayPremium, 48000);  // 8h*12000*0.5
  assert.equal(r.overtimePremium, 0);
  assert.equal(r.gross, 144000);
});

// 6) 휴일 10h : 8h +50%, 2h +100%
t('휴일 10h — 8h 50% + 2h 100%', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T09:00:00', endAt: '2026-07-01T20:00:00', isHoliday: true }, W, BIG);
  assert.equal(r.workedMinutes, 600);
  assert.equal(r.holidayPremium, 72000);  // 48000 + 24000
  assert.equal(r.gross, 192000);
});

// 7) 최저임금 미달 경고
t('최저임금 미달 경고', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T09:00:00', endAt: '2026-07-01T18:00:00' }, 9000, BIG);
  assert.ok(r.warnings.some(w => w.includes('최저시급')));
});

// 8) 휴게 명시 입력
t('휴게 명시(30분)', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T09:00:00', endAt: '2026-07-01T18:00:00', breakMinutes: 30 }, W, BIG);
  assert.equal(r.breakMinutes, 30);
  assert.equal(r.workedMinutes, 510);   // 8.5h
});

// 9) 주휴수당
t('주휴 — 40h 개근 = 8h분', () => assert.equal(calcWeeklyHolidayPay(40, true, W), 96000));
t('주휴 — 20h 개근 = 4h분', () => assert.equal(calcWeeklyHolidayPay(20, true, W), 48000));
t('주휴 — 15h 미만 = 0', () => assert.equal(calcWeeklyHolidayPay(14, true, W), 0));
t('주휴 — 결근 = 0', () => assert.equal(calcWeeklyHolidayPay(40, false, W), 0));

// 10) 연장+야간 중복 가산 (09-23, 휴게60 → 13h) : OT 5h + 야간 1h 둘 다
t('연장+야간 중복', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T09:00:00', endAt: '2026-07-01T23:00:00' }, W, BIG);
  assert.equal(r.workedMinutes, 780);
  assert.equal(r.overtimeMinutes, 300);          // 5h
  assert.equal(r.nightMinutes, 60);              // 22-23
  assert.equal(r.base, 156000);                  // 13h
  assert.equal(r.overtimePremium, 30000);        // 5h*0.5
  assert.equal(r.nightPremium, 6000);            // 1h*0.5
  assert.equal(r.gross, 192000);
});

// 11) 휴일+야간 중복 (18-02, 휴게60 → 7h) : 휴일 50% + 야간 50%
t('휴일+야간 중복', () => {
  const r = calcShiftWage({ startAt: '2026-07-01T18:00:00', endAt: '2026-07-02T02:00:00', isHoliday: true }, W, BIG);
  assert.equal(r.workedMinutes, 420);
  assert.equal(r.nightMinutes, 240);             // 22-02 = 4h
  assert.equal(r.base, 84000);                   // 7h
  assert.equal(r.holidayPremium, 42000);         // 7h*0.5
  assert.equal(r.nightPremium, 24000);           // 4h*0.5
  assert.equal(r.overtimePremium, 0);            // 휴일은 연장가산 별도 안 함
  assert.equal(r.gross, 150000);
});

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
