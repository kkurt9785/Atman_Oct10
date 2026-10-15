import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), revive: vi.fn(), recheck: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ adminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/demo/revive-showcase', () => ({ reviveDemoShowcase: mocks.revive }));
vi.mock('@/lib/business-status', () => ({ recheckStaleBusinessStatuses: mocks.recheck }));
vi.mock('@/lib/date', () => ({ todayKST: () => '2026-10-14' }));
// These routes use admin-local @ aliases. Their types are checked by admin's
// tsconfig; loading by path here prevents worker's aliases from checking them.
const expireModule = '../../../admin-web/app/api/cron/expire-shifts/route';
const resetModule = '../../../admin-web/app/api/cron/revive-demo/route';
const { GET: expire } = await import(expireModule);
const { GET: resetGet, POST: resetPost } = await import(resetModule);

function request(body?: unknown, authorized = true) {
  return new NextRequest('https://admin.example/api/cron/revive-demo', { method: 'POST', headers: { authorization: authorized ? 'Bearer qa-secret' : 'Bearer invalid', 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}
beforeEach(() => {
  vi.clearAllMocks();vi.stubEnv('CRON_SECRET', 'qa-secret');vi.stubEnv('DEMO_SHOWCASE_ENABLED', 'true');
  mocks.rpc.mockResolvedValue({ data: { workers: 1 }, error: null });
  const query: any = { then: (done: any) => Promise.resolve({ data: [], error: null }).then(done) };
  for(const name of ['update','select','eq','lt','in'])query[name]=()=>query;
  mocks.from.mockReturnValue(query);
  mocks.recheck.mockResolvedValue({ ok: true });mocks.revive.mockResolvedValue({ ok: true, totals: {} });
});
afterEach(() => vi.unstubAllEnvs());

describe('일일 시연 재시드와 수동 초기화 권한', () => {
  it('일일 만료 처리 후 시연을 재시드하고 근무 가능 시간을 갱신한다', async () => {
    const response = await expire(request());
    expect(response.status).toBe(200);
    expect(mocks.revive).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('refresh_demo_worker_readiness');
    expect(mocks.from.mock.invocationCallOrder[0]).toBeLessThan(mocks.revive.mock.invocationCallOrder[0]);
    expect(mocks.revive.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });
  it('시연 준비 RPC 실패를 기록하되 일반 공고 만료 처리는 유지한다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'missing migration' } });
    const response = await expire(request());
    expect(response.status).toBe(200);
    expect((await response.json()).demo.readiness).toEqual({ok:false,error:'missing migration'});
    expect(mocks.from).toHaveBeenCalled();expect(mocks.revive).toHaveBeenCalledOnce();
  });
  it('데모 비활성 상태에서는 일반 만료 처리만 실행한다', async () => {
    vi.stubEnv('DEMO_SHOWCASE_ENABLED', 'false');
    expect((await expire(request())).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.from).toHaveBeenCalled();
  });
  it('GET으로 데이터를 초기화할 수 없다', async () => {
    expect((await resetGet()).status).toBe(405);expect(mocks.revive).not.toHaveBeenCalled();
  });
  it('수동 POST라도 인증 또는 명시적 확인이 없으면 중단한다', async () => {
    expect((await resetPost(request({confirmReset:'RESET_DEMO_DATA'},false))).status).toBe(401);
    expect((await resetPost(request())).status).toBe(400);
    expect(mocks.revive).not.toHaveBeenCalled();
  });
  it('데모 비활성 상태에서는 수동 초기화도 금지한다', async () => {
    vi.stubEnv('DEMO_SHOWCASE_ENABLED', 'false');
    expect((await resetPost(request({confirmReset:'RESET_DEMO_DATA'}))).status).toBe(403);
    expect(mocks.revive).not.toHaveBeenCalled();
  });
  it('인증된 명시적 POST만 수동 초기화를 실행한다', async () => {
    expect((await resetPost(request({confirmReset:'RESET_DEMO_DATA'}))).status).toBe(200);
    expect(mocks.revive).toHaveBeenCalledOnce();
  });
});
