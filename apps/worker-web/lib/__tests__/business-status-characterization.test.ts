import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../../admin-web/lib/nts', () => ({ checkBusinessStatus: mocks.check }));
const modulePath = '../../../admin-web/lib/business-status';
const { refreshFacilityBusinessStatus } = await import(modulePath);
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
describe('C10 현재 사업자 상태 저장 경로', () => {
  it('조회 결과 DB 저장 실패를 성공 결과로 반환하지 않는다', async () => {
    const result = { status: 'closed', detail: '폐업', checkedAt: '2026-10-14T00:00:00Z' };
    mocks.check.mockResolvedValue(result);
    const eq = vi.fn().mockResolvedValue({ error: { message: 'QA write denied' } });
    const sb = { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) }) };
    await expect(refreshFacilityBusinessStatus(sb, 'qa-facility', '1234567890')).rejects.toThrow('저장하지 못했어요');
    expect(eq).toHaveBeenCalledWith('id', 'qa-facility');
  });
  it('PASS: API 조회 실패이면 결과를 저장하지 않는다', async () => {
    mocks.check.mockResolvedValue(null);
    const sb = { from: vi.fn() };
    expect(await refreshFacilityBusinessStatus(sb, 'qa-facility', '1234567890')).toBeNull();
    expect(sb.from).not.toHaveBeenCalled();
  });
});
