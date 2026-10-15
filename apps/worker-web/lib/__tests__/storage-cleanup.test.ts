import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn(), adminClient: vi.fn() }));
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: mocks.adminClient }));
import { cleanupAccountStorage } from '../../../admin-web/lib/account-storage-cleanup';
const job = { id: 'job', bucket_id: 'license-photos', object_path: '10000000-0000-4000-8000-000000000001/license.jpg' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminClient.mockReturnValue({ rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove }) } });
  mocks.rpc.mockImplementation(async name => ({ data: name === 'claim_account_storage_cleanup' ? [job] : null, error: null }));
  mocks.remove.mockResolvedValue({ error: null });
});
describe('탈퇴 후 파일 삭제 작업', () => {
  it('파일 삭제 성공 뒤에만 작업을 완료한다', async () => {
    expect(await cleanupAccountStorage()).toEqual({ completed: 1, retrying: 0 });
    expect(mocks.remove).toHaveBeenCalledWith([job.object_path]);
    expect(mocks.rpc).toHaveBeenLastCalledWith('finish_account_storage_cleanup', { p_id: 'job', p_success: true });
  });
  it('저장소 실패는 재시도 작업으로 남긴다', async () => {
    mocks.remove.mockResolvedValue({ error: { message: 'unavailable' } });
    expect(await cleanupAccountStorage()).toEqual({ completed: 0, retrying: 1 });
    expect(mocks.rpc).toHaveBeenLastCalledWith('finish_account_storage_cleanup', { p_id: 'job', p_success: false });
  });
  it('저장소 예외도 작업 완료로 표시하지 않는다', async () => {
    mocks.remove.mockRejectedValue(new Error('network'));
    expect(await cleanupAccountStorage()).toEqual({ completed: 0, retrying: 1 });
  });
});
