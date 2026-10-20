import { describe, expect, it, vi } from 'vitest';
import { effectiveBreakMinutes, isAttendanceCovered, type PayoutCoverage } from '../shared/gig-pay/calculation';
import { effectiveBreakMinutes as workerBreak } from '../gig-pay';
import { effectiveBreakMinutes as adminBreak } from '../../../admin-web/lib/pay-statement';

vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: vi.fn(), userClient: vi.fn() }));
vi.mock('../../../admin-web/lib/facility', () => ({ getCurrentFacilityId: vi.fn() }));
import { amountFor, summarizeWork } from '../../../admin-web/lib/db/gig-payouts';

const row = { id: 'a', work_date: '2026-10-13', check_in_at: '2026-10-13T20:00:00+09:00', check_out_at: '2026-10-14T04:00:00+09:00', break_minutes: 0 };
const payout = (ids: string[] | null, status = 'paid'): PayoutCoverage => ({ attendance_ids: ids, status, period_start: row.work_date, period_end: row.work_date, covered_until: row.check_out_at });
function client(data: unknown, error: unknown = null) {
  return { from: () => {
    let cursor = '', size = 500;
    const query: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'gte', 'lte', 'order']) query[name] = () => query;
    query.gt = (_column: string, value: string) => { cursor = value; return query; };
    query.limit = (value: number) => { size = value; return query; };
    query.then = (resolve: (result: unknown) => void) => resolve({ data: Array.isArray(data) ? data.filter(row => !cursor || row.id > cursor).slice(0, size) : data, error });
    return query;
  }} as unknown as Parameters<typeof summarizeWork>[0];
}

describe('지급 계산 회귀', () => {
  it.each([effectiveBreakMinutes, workerBreak, adminBreak])('명시한 휴게 0분과 누락값에 기본 휴게를 재차감하지 않는다', (calculate) => {
    expect(calculate(480, 0, 60)).toBe(0);
    expect(calculate(480, null, 60)).toBe(0);
    expect(calculate(480, 30, 60)).toBe(30);
    expect(calculate(60, 90, 60)).toBe(60);
    expect(calculate(480, -30, 60)).toBe(0);
  });
  it('A를 취소하고 B가 남아 있어도 A 근태는 다시 지급 대상이다', () => {
    expect(isAttendanceCovered(row, [payout(['a'], 'cancelled'), payout(['b'])])).toBe(false);
    expect(isAttendanceCovered(row, [payout(['a'])])).toBe(true);
  });
  it('같은 퇴근 시각이어도 서로 다른 근태를 구분한다', () => {
    expect(isAttendanceCovered({ ...row, id: 'b' }, [payout(['a'])])).toBe(false);
  });
  it('기존 지급은 자기 기간만 포함하며 다른 날짜까지 덮지 않는다', () => {
    expect(isAttendanceCovered(row, [payout(null)])).toBe(true);
    expect(isAttendanceCovered({ ...row, work_date: '2026-10-12' }, [payout(null)])).toBe(false);
    expect(isAttendanceCovered({ ...row, check_out_at: '2026-10-14T05:00:00+09:00' }, [payout(null)])).toBe(false);
  });
  it('야간 근무와 취소 후 재지급을 실제 집계한다', async () => {
    const result = await summarizeWork(client([row]), 'facility', 'staff', '2020-01-01', '2026-10-14', { payouts: [payout(['a'], 'cancelled'), payout(['b'])] });
    expect(result).toMatchObject({ attendanceIds: ['a'], minutes: 480, days: 1, breakMinutes: 0, firstDate: '2026-10-13', lastCheckOut: row.check_out_at });
    expect(amountFor('hourly', 15000, result.minutes, result.days)).toBe(120000);
  });
  it('완료된 지급의 근태는 다시 합산하지 않는다', async () => {
    const result = await summarizeWork(client([row]), 'f', 's', '2020-01-01', '2026-10-14', { payouts: [payout(['a'])] });
    expect(result.minutes).toBe(0);
    expect(result.attendanceIds).toEqual([]);
  });
  it('조회 오류와 잘못된 중복 페이지는 0원 또는 일부 지급으로 처리하지 않는다', async () => {
    await expect(summarizeWork(client(null, { message: 'offline' }), 'f', 's', '', '')).rejects.toThrow('전체 운영 데이터');
    await expect(summarizeWork(client(Array(1000).fill(row)), 'f', 's', '', '')).rejects.toThrow('조회 순서');
  });
  it('월급을 매 근무마다 반복 지급하거나 근무 없는 날 일급을 만들지 않는다', () => {
    expect(amountFor('monthly', 3000000, 60, 1)).toBe(0);
    expect(amountFor('daily', 100000, 0, 0)).toBe(0);
    expect(amountFor('daily', 100000, 480, 2)).toBe(200000);
  });
});
