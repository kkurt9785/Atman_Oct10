import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('../../../admin-web/lib/business-status', () => ({ refreshFacilityBusinessStatus: mocks.refresh }));
const modulePath = '../../../admin-web/lib/platform-approval';
const { approveFacilityCore } = await import(modulePath);
beforeEach(() => vi.resetAllMocks());
describe('사업자 조회 실패는 승인으로 넘어가지 않는다', () => {
  it.each([null, { status: 'closed', detail: '폐업' }, { status: 'suspended', detail: '휴업' }])('미확인 또는 제한 상태: %j', async (status) => {
    mocks.refresh.mockResolvedValue(status);
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'f', registration_source: 'self_gig', approved_at: null, deleted_at: null } })
      .mockResolvedValueOnce({ data: null });
    const update = vi.fn();
    const query: Record<string, unknown> = { maybeSingle, update };
    for (const key of ['select', 'eq', 'neq', 'is']) query[key] = () => query;
    const result = await approveFacilityCore({ from: () => query }, { id: 'operator', email: null }, { facilityId: 'f', brn: '1234567890' });
    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
