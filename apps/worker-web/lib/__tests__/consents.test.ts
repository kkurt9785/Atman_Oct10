import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ order: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ in: () => ({ order: mocks.order }) }) }) } }));
vi.mock('@/components/onboarding/Terms', () => ({ CONSENT_VERSION: 'test' }));
import { getMyConsents, isLocationAllowed } from '../consents';
beforeEach(() => mocks.order.mockReset());

describe('위치정보 동의 확인', () => {
  it('조회 실패를 동의로 간주하지 않는다', async () => {
    mocks.order.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await isLocationAllowed()).toBe(false);
    await expect(getMyConsents()).rejects.toThrow('동의 상태');
  });
  it('동의 기록이 없으면 위치를 사용하지 않는다', async () => {
    mocks.order.mockResolvedValue({ data: [], error: null });
    expect(await isLocationAllowed()).toBe(false);
  });
  it('일시적 통신 예외 후 다시 조회할 수 있다', async () => {
    mocks.order.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: [{ consent_type: 'location_data', granted: true }], error: null });
    expect(await isLocationAllowed()).toBe(false);
    expect(await isLocationAllowed()).toBe(true);
  });
  it('계정 전환·외부 철회 후 이전 동의값을 재사용하지 않는다', async () => {
    mocks.order.mockResolvedValueOnce({ data: [{ consent_type: 'location_data', granted: true }], error: null })
      .mockResolvedValueOnce({ data: [{ consent_type: 'location_data', granted: false }, { consent_type: 'location_data', granted: true }], error: null });
    expect(await isLocationAllowed()).toBe(true);
    expect(await isLocationAllowed()).toBe(false);
  });
});
