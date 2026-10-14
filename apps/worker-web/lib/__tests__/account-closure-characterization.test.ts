// Regressions for the account-closure defects found during the MD audit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), userClient: vi.fn(), adminClient: vi.fn(), deleteUser: vi.fn(), clear: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ requireAdminSession: mocks.session, requireAdminContext: mocks.session, clearAdminCookies: mocks.clear }));
vi.mock('@/lib/supabase', () => ({ userClient: mocks.userClient, adminClient: mocks.adminClient }));
vi.mock('@/lib/demo-guard', () => ({ assertNotDemoFacility: vi.fn() }));
const modulePath = '../../../admin-web/lib/actions/account';
const { withdrawAdminAccountAction } = await import(modulePath);
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.session.mockResolvedValue({ accessToken: 'qa-token', user: { id: 'qa-user' } });
  mocks.userClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { ok: true, keepAuth: false }, error: null });
  mocks.adminClient.mockReturnValue({ auth: { admin: { deleteUser: mocks.deleteUser } } });
  mocks.deleteUser.mockResolvedValue({ error: null });
});
afterEach(() => vi.restoreAllMocks());
describe('C9 탈퇴 실패를 완료로 표시하지 않는다', () => {
  it('인증 계정 삭제 실패면 재시도할 수 있도록 세션을 유지한다', async () => {
    mocks.deleteUser.mockResolvedValue({ error: { message: 'QA deletion blocked' } });
    expect((await withdrawAdminAccountAction()).ok).toBe(false);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it('관리자 서비스 연결이 없으면 DB 정리 전에 중단한다', async () => {
    mocks.adminClient.mockReturnValue(null);
    expect((await withdrawAdminAccountAction()).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it('RPC 결과가 null이면 인증 계정을 삭제하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await withdrawAdminAccountAction()).ok).toBe(false);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it('PASS: 근무자 프로필 유지 요청이면 인증 계정은 삭제하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, keepAuth: true }, error: null });
    expect(await withdrawAdminAccountAction()).toEqual({ ok: true });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it('PASS: DB에서 거부하면 후속 계정 삭제는 하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: '운영 중인 사업장' } });
    expect((await withdrawAdminAccountAction()).ok).toBe(false);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it('인증 삭제까지 성공한 경우에만 세션을 정리한다', async () => {
    expect(await withdrawAdminAccountAction()).toEqual({ ok: true });
    expect(mocks.deleteUser).toHaveBeenCalledWith('qa-user');
    expect(mocks.clear).toHaveBeenCalledOnce();
  });
  it.each([{ ok: false, keepAuth: false }, { ok: true }, { ok: true, keepAuth: 'false' }])('잘못된 RPC 결과는 거부한다: %j', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await withdrawAdminAccountAction()).ok).toBe(false);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
