import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attendancePersonKey, shiftRecognition } from '../../../admin-web/lib/attendance-recognition';

const state = vi.hoisted(() => ({ fail: false, calls: [] as { table: string; filters: string[] }[] }));
vi.mock('../../../admin-web/lib/facility', () => ({ getCurrentFacilityId: async () => 'facility-a' }));
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: () => ({ from(table: string) {
  let cursor = ''; let limit = 1000; const filters: string[] = [];
  const q: any = {
    select: () => q, order: () => q,
    eq: (key: string, value: string) => { filters.push(`${key}=${value}`); return q; },
    gte: (key: string, value: string) => { filters.push(`${key}>=${value}`); return q; },
    lte: (key: string, value: string) => { filters.push(`${key}<=${value}`); return q; },
    gt: (_: string, value: string) => { cursor = value; return q; },
    limit: (value: number) => { limit = value; return q; },
    maybeSingle: () => q,
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      state.calls.push({ table, filters: [...filters] });
      if (table === 'attendance_period_closures') return Promise.resolve({ data: { status: 'open' }, error: null }).then(resolve, reject);
      const data = Array.from({ length: 1050 }, (_, i) => ({
        id: String(i).padStart(6, '0'), staff_id: `staff-${i}`, worker_id: `worker-${i}`, work_date: '2026-10-01',
        check_in_at: '2026-10-01T00:00:00Z', check_out_at: '2026-10-01T09:00:00Z', status: 'completed',
        facility_staff: { name: '김민수' }, workers: { name: '김민수' },
        shifts: { shift_date: '2026-10-01' }, wage_calculations: i === 1049 ? [] : [{ worked_minutes: 480, break_minutes: 60 }],
      })).filter(row => row.id > cursor).slice(0, limit);
      return Promise.resolve({ data, error: state.fail && table === 'shift_attendances' && cursor ? { message: 'page failed' } : null }).then(resolve, reject);
    },
  };
  return q;
} }) }));
import { getAttendanceHistory } from '../../../admin-web/lib/db/attendance-history';

beforeEach(() => { state.fail = false; state.calls = []; });
describe('attendance history integrity', () => {
  it('reads all 1050 records per source while retaining facility and month scopes on every page', async () => {
    const { rows } = await getAttendanceHistory('2026-10');
    expect(rows).toHaveLength(2100);
    for (const call of state.calls.filter(call => call.table !== 'attendance_period_closures')) {
      const shift = call.table === 'shift_attendances';
      expect(call.filters).toEqual(expect.arrayContaining([
        `${shift ? 'shifts.facility_id' : 'facility_id'}=facility-a`,
        `${shift ? 'shifts.shift_date' : 'work_date'}>=2026-10-01`,
        `${shift ? 'shifts.shift_date' : 'work_date'}<=2026-10-31`,
      ]));
    }
  });
  it('does not return partial records if a subsequent source page fails', async () => {
    state.fail = true;
    await expect(getAttendanceHistory('2026-10')).rejects.toThrow('전체 운영 데이터');
  });
  it('uses persisted recognition, not nine-hour elapsed time, and flags missing settlement', async () => {
    const { rows } = await getAttendanceHistory('2026-10');
    expect(rows.find(row => row.kind === 'shift' && row.id === '000000')).toMatchObject({ workedMinutes: 480, breakMinutes: 60, recognitionPending: false, workerId: 'worker-0' });
    expect(rows.find(row => row.kind === 'shift' && row.id === '001049')).toMatchObject({ workedMinutes: 0, recognitionPending: true });
  });
  it('keeps namesakes separate but groups multiple attendances of the same worker', () => {
    const a = { id: 'a', staffId: null, workerId: 'worker-a' };
    const b = { id: 'b', staffId: null, workerId: 'worker-b' };
    expect(attendancePersonKey(a)).not.toBe(attendancePersonKey(b));
    expect(attendancePersonKey(a)).toBe(attendancePersonKey({ ...a, id: 'other-day' }));
    expect(attendancePersonKey({ ...a, workerId: null })).not.toBe(attendancePersonKey({ ...b, workerId: null }));
  });
  it('preserves recorded zero breaks and arbitrary historical minutes', () => {
    expect(shiftRecognition({ worked_minutes: 513, break_minutes: 0 })).toEqual({ workedMinutes: 513, breakMinutes: 0, recognitionPending: false });
  });
  it('rejects invalid or duplicate settlements instead of quietly picking a value', () => {
    expect(() => shiftRecognition({ worked_minutes: null, break_minutes: 0 })).toThrow();
    expect(() => shiftRecognition([{ worked_minutes: 10, break_minutes: 0 }, { worked_minutes: 20, break_minutes: 0 }])).toThrow();
  });
});
