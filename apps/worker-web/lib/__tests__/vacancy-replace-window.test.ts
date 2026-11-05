import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 2026-11-05 결정 A — 미출근 대체(결원 채우기 replace)는 '지금 + 30분'부터 원래 종료까지 연다.
// 원래 시작 시각을 그대로 쓰면 invite_to_vacancy·respond_to_shift_invitation·apply_to_shift 가 모두 '이미 시작한 근무'로 거부했다.
const mocks = vi.hoisted(() => ({ existing: null as Record<string, unknown> | null }));
vi.mock('server-only', () => ({}));
vi.mock('../../../admin-web/lib/admin-auth', () => ({ getAdminContext: async () => ({ facilityId: 'fac', accessToken: 't' }) }));
vi.mock('../../../admin-web/lib/db/operations', () => ({ getWorkforceRecommendations: async () => [] }));
const original = { id: 'orig', shift_date: '2026-11-05', start_time: '07:00:00', end_time: '15:00:00', required_role: 'na', department: '3병동', hourly_wage: 12000, description: '병동 근무', status: 'matched', audience: 'public', workers: { name: '김근무' } };
function from(table: string) {
  const filters: Record<string, unknown> = {};
  const q: Record<string, unknown> = {
    select: () => q, neq: () => q, in: () => q,
    eq: (k: string, v: unknown) => { filters[k] = v; return q; },
    maybeSingle: async () => {
      if (table !== 'shifts') return { data: null };
      if ('replacement_for_shift_id' in filters) return { data: mocks.existing };
      return { data: filters.id === 'orig' ? original : null };
    },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 0, data: [], error: null }).then(resolve),
  };
  return q;
}
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: () => ({ from }), userClient: () => null }));

const vacancyModule = '../../../admin-web/lib/db/vacancy';
const { resolveVacancy } = await import(vacancyModule) as { resolveVacancy: (s: unknown) => Promise<Record<string, unknown> | null> };

describe('결원 채우기 — 미출근 대체 시간', () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.existing = null; });
  afterEach(() => { vi.useRealTimers(); });

  it('07:35 요청이면 08:10–15:00 으로 열고 원래 시작을 안내용으로 남긴다', async () => {
    vi.setSystemTime(new Date('2026-11-05T07:35:00+09:00'));
    expect(await resolveVacancy({ mode: 'replace', shiftId: 'orig' })).toMatchObject({
      date: '2026-11-05', startTime: '08:10', endTime: '15:00', originalStartTime: '07:00', unavailableReason: null, staleReplacementId: null, shiftId: null,
    });
  });

  it('남은 근무가 2시간 미만이면 열지 않는다', async () => {
    vi.setSystemTime(new Date('2026-11-05T12:40:00+09:00'));
    expect((await resolveVacancy({ mode: 'replace', shiftId: 'orig' }))?.unavailableReason).toMatch(/2시간이 안 돼서/);
  });

  it('시작이 지난 예전 대체 근무(원래 시각)는 닫을 대상으로 표시하고 새 시간으로 연다', async () => {
    vi.setSystemTime(new Date('2026-11-05T08:00:00+09:00'));
    mocks.existing = { id: 'old-repl', shift_date: '2026-11-05', start_time: '07:00:00', status: 'open' };
    expect(await resolveVacancy({ mode: 'replace', shiftId: 'orig' })).toMatchObject({ staleReplacementId: 'old-repl', startTime: '08:30', shiftId: null });
  });
});
