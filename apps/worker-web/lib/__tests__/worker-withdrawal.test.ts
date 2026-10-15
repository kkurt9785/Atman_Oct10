import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), signOut: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: mocks.getUser, signOut: mocks.signOut }, rpc: mocks.rpc,
  storage: { from: () => ({ list: vi.fn(), remove: mocks.remove }) },
} }));
import { withdrawWorkerAccount } from '../withdraw-account';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'worker' } }, error: null });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
describe('근무자 탈퇴와 파일 보존', () => {
  it('확정 근무 등으로 탈퇴가 거절되면 파일과 세션을 보존한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: '확정된 근무가 남아 있어요' } });
    await expect(withdrawWorkerAccount()).rejects.toThrow('확정된 근무');
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it.each([null, false, { ok: true }])('명시적인 완료 응답이 아니면 성공으로 표시하지 않는다: %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(withdrawWorkerAccount()).rejects.toThrow('결과를 확인');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('통신 예외를 전달하고 파일·세션을 유지한다', async () => {
    mocks.rpc.mockRejectedValue(new Error('network'));
    await expect(withdrawWorkerAccount()).rejects.toThrow('network');
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it('승인 뒤 현재 기기의 세션만 정리하고 파일은 서버 작업에 맡긴다', async () => {
    await withdrawWorkerAccount();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
