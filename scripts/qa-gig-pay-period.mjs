// Pure checks for the gig pay period end and bulk eligibility (apps/admin-web/lib/gig-pay-period.ts).
// Node 22.18+/26 strips TypeScript types, so the helper is imported directly. No network, no DB.
import assert from 'node:assert/strict';
import { addDays, assertPayUntil, lastWeekSunday, payoutBlocker, periodChips, resolvePayUntil, todayKST, untilLabel } from '../apps/admin-web/lib/gig-pay-period.ts';

// 2026-11-05 is a Thursday.
assert.equal(lastWeekSunday('2026-11-05'), '2026-11-01');
assert.equal(lastWeekSunday('2026-11-09'), '2026-11-08', 'Monday → yesterday');
assert.equal(lastWeekSunday('2026-11-08'), '2026-11-01', 'Sunday → the week before, this week is not over');
assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');
assert.equal(todayKST(Date.parse('2026-11-04T15:30:00Z')), '2026-11-05', 'KST midnight boundary');

assert.equal(resolvePayUntil(undefined, '2026-11-05'), '2026-11-05');
assert.equal(resolvePayUntil('2026-11-01', '2026-11-05'), '2026-11-01');
assert.equal(resolvePayUntil('2026-11-06', '2026-11-05'), '2026-11-05', 'future → today');
assert.equal(resolvePayUntil('2019-12-31', '2026-11-05'), '2026-11-05', 'too old → today');
assert.equal(resolvePayUntil('2026-02-30', '2026-11-05'), '2026-11-05', 'invalid day');
assert.equal(resolvePayUntil('11/01', '2026-11-05'), '2026-11-05');
assert.equal(assertPayUntil('', '2026-11-05'), '2026-11-05');
assert.equal(assertPayUntil('2026-11-01', '2026-11-05'), '2026-11-01');
assert.throws(() => assertPayUntil('2026-11-06', '2026-11-05'), /오늘이나 그 이전/);

assert.deepEqual(periodChips('2026-11-05').map(c => c.until), ['2026-11-05', '2026-11-04', '2026-11-01']);
assert.deepEqual(periodChips('2026-11-09').map(c => c.label), ['오늘까지', '어제까지'], 'Monday: 어제 = 지난주 일요일, one chip');
assert.equal(untilLabel('2026-11-05', '2026-11-05'), '오늘');
assert.equal(untilLabel('2026-11-01', '2026-11-05'), '11월 1일');

const ok = { payBasis: 'hourly', payRate: 10320, accountNumber: '110-123-456789', unpaidAmount: 82560, unpaidDays: 1 };
assert.equal(payoutBlocker(ok), null);
assert.equal(payoutBlocker({ ...ok, payRate: null }), '급여 기준 미설정');
assert.equal(payoutBlocker({ ...ok, payBasis: 'monthly' }), '월급 근무자는 따로 검토');
assert.equal(payoutBlocker({ ...ok, unpaidDays: 0, unpaidAmount: 0 }), '이 기간에 지급할 근무 없음');
assert.equal(payoutBlocker({ ...ok, accountNumber: null }), '지급 계좌 전달 대기');
assert.equal(payoutBlocker({ ...ok, unpaidAmount: 0 }), '지급액 0원 · 출퇴근·휴게 확인');
console.log(JSON.stringify({ result: 'PASS', checks: 27 }));
