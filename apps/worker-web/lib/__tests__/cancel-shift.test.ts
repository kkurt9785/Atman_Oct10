import { beforeEach, describe, expect, it, vi } from 'vitest';

// 2026-11-05 QA P0 ⑥ — 확정 근무를 취소해도 근무자 '채용 확정·출근하기', 열린 대타 요청, 근태 '출근 예정'이 남았다.
type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]> };
const mocks = vi.hoisted(() => ({ calls: [] as Call[], started: false, nudge: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../admin-web/node_modules/next/cache.js', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('../../../admin-web/node_modules/next/navigation.js', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('../../../admin-web/lib/admin-auth', () => ({ requireAdminContext: async () => ({ facilityId: 'fac', user: { id: 'admin' } }) }));
vi.mock('../../../admin-web/lib/notify-nudge', () => ({ nudgeNotificationDispatch: mocks.nudge }));
vi.mock('../../../admin-web/lib/db/shifts', () => ({ createShift: vi.fn() }));
vi.mock('@/lib/facility-mode', () => ({ isGigworkerFacility: () => false }));

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  mocks.calls.push(call);
  const result = () => {
    if (table === 'shifts' && call.op === 'select') return { data: { id: 'shift', shift_date: '2026-11-05', start_time: '15:30', status: 'matched', workers: { auth_user_id: 'worker-auth' } } };
    if (table === 'shift_attendances') return { data: mocks.started ? { id: 'att' } : null };
    if (table === 'shifts' && call.op === 'update') return { data: { id: 'shift' } };
    if (table === 'shift_applications') return { data: [] };
    if (table === 'shift_cover_requests') return { data: [{ id: 'cover', status: 'claimed', claimer: { auth_user_id: 'claimer-auth' } }] };
    return { data: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    update: (payload: unknown) => { call.op = 'update'; call.payload = payload; return chain; },
    upsert: (payload: unknown) => { call.op = 'upsert'; call.payload = payload; return chain; },
    eq: (k: string, v: unknown) => { call.filters.push(['eq', k, v]); return chain; },
    in: (k: string, v: unknown) => { call.filters.push(['in', k, v]); return chain; },
    not: (k: string, _o: string, v: unknown) => { call.filters.push(['not', k, v]); return chain; },
    limit: () => chain,
    maybeSingle: async () => ({ error: null, ...result() }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null, ...result() }).then(resolve),
  };
  return chain;
}
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: () => ({ from: builder }) }));

// 관리자 앱 별칭(@/lib/...)은 관리자 tsconfig 가 검사한다 — 근무자 tsc 가 따라가지 않게 경로를 변수로(payroll-integrity 테스트와 같은 방식)
const actionModule = '../../../admin-web/lib/actions/shifts';
const { cancelShiftAction } = await import(actionModule) as { cancelShiftAction: (shiftId: string) => Promise<{ ok: false; message: string } | void> };

describe('cancelShiftAction', () => {
  beforeEach(() => { mocks.calls.length = 0; mocks.started = false; });

  it('확정 지원을 사업장 취소로 닫고 열린 대타 요청을 닫고 대타를 맡은 동료에게도 알린다', async () => {
    await expect(cancelShiftAction('shift')).rejects.toThrow('REDIRECT /shifts?cancelled=1');
    const accepted = mocks.calls.find((c) => c.table === 'shift_applications' && c.op === 'update' && c.filters.some(([, k, v]) => k === 'status' && v === 'accepted'));
    expect(accepted?.payload).toMatchObject({ status: 'cancelled' });
    const cover = mocks.calls.find((c) => c.table === 'shift_cover_requests' && c.op === 'update');
    expect(cover?.payload).toMatchObject({ status: 'cancelled' });
    expect(cover?.filters).toContainEqual(['in', 'status', ['open', 'claimed']]);
    const outbox = mocks.calls.filter((c) => c.table === 'notification_outbox').flatMap((c) => c.payload as Array<{ worker_auth_user_id: string; body: string }>);
    expect(outbox.map((row) => row.worker_auth_user_id).sort()).toEqual(['claimer-auth', 'worker-auth']);
    expect(outbox.every((row) => !row.body.includes('습니다'))).toBe(true);
  });

  it('이미 출근한 근무는 취소하지 않고 이유를 돌려준다', async () => {
    mocks.started = true;
    await expect(cancelShiftAction('shift')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('이미 출근한 근무') });
    expect(mocks.calls.some((c) => c.table === 'shifts' && c.op === 'update')).toBe(false);
  });
});
