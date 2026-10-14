import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), upsert: vi.fn(), remove: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: mocks.user }, from: () => ({ upsert: mocks.upsert, delete: mocks.remove }) } }));
import { disableShiftPush, enableShiftPush } from '../push-subscribe';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.remove.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValueOnce({ eq: mocks.eq }).mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function supported(permission = 'granted', existing = true) {
  const requestPermission = vi.fn().mockResolvedValue(permission);
  const subscription = { endpoint: 'https://push.example/test', toJSON: () => ({ endpoint: 'https://push.example/test' }), unsubscribe: vi.fn().mockResolvedValue(true) };
  const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(existing ? subscription : null), subscribe: vi.fn().mockResolvedValue(subscription) } };
  vi.stubGlobal('window', { PushManager: function () {}, atob: globalThis.atob });
  vi.stubGlobal('navigator', { serviceWorker: { register: async () => registration, getRegistration: async () => registration, ready: Promise.resolve() } });
  vi.stubGlobal('Notification', { requestPermission });
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AQID');
  return { requestPermission, subscription, registration };
}
describe('푸시 설정의 실제 저장 결과', () => {
  it('로그인 만료를 알림 켜짐으로 보고하지 않는다', async () => {
    supported();mocks.user.mockResolvedValue({ data: { user: null } });
    await expect(enableShiftPush()).rejects.toThrow('로그인');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('권한 요청은 사용자 클릭 직후 네트워크 조회 전에 시작한다', async () => {
    const { requestPermission } = supported();
    mocks.user.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.upsert.mockResolvedValue({ error: null });
    const work = enableShiftPush();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(await work).toBe('enabled');
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });
  it('알림 권한 거절은 구독 저장을 하지 않는다', async () => {
    supported('denied');
    expect(await enableShiftPush()).toBe('denied');
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('기존 구독의 저장 재시도가 실패해도 기존 구독은 해제하지 않는다', async () => {
    const { subscription } = supported();
    mocks.upsert.mockResolvedValue({ error: new Error('저장 실패') });
    await expect(enableShiftPush()).rejects.toThrow('저장 실패');
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
  it.each(['auth', 'save'])('새 구독은 %s 실패 시 해제한다', async (phase) => {
    const { subscription } = supported('granted', false);
    if (phase === 'auth') mocks.user.mockResolvedValue({ data: { user: null } });
    else mocks.upsert.mockRejectedValue(new Error('network'));
    await expect(enableShiftPush()).rejects.toThrow();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
  it('기기 구독이 없으면 다른 기기의 저장 행을 지우지 않는다', async () => {
    supported('granted', false);
    await disableShiftPush();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('해제는 현재 사용자와 기기 endpoint 둘 다 지정한다', async () => {
    const { subscription } = supported();
    await disableShiftPush();
    expect(mocks.eq.mock.calls).toEqual([['worker_id', 'u1'], ['endpoint', subscription.endpoint]]);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
  it('서버 해제 실패 시 기기 구독을 유지한다', async () => {
    const { subscription } = supported();
    mocks.eq.mockReset().mockReturnValueOnce({ eq: mocks.eq }).mockResolvedValue({ error: new Error('해제 실패') });
    await expect(disableShiftPush()).rejects.toThrow('해제 실패');
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
  it('로그인 만료 상태에서는 기기 해제를 시작하지 않는다', async () => {
    const { subscription } = supported();
    mocks.user.mockResolvedValue({ data: { user: null } });
    await expect(disableShiftPush()).rejects.toThrow('로그인');
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
  it('브라우저가 구독을 계속 유지하면 해제 완료로 보고하지 않는다', async () => {
    const { subscription } = supported();
    subscription.unsubscribe.mockResolvedValue(false);
    await expect(disableShiftPush()).rejects.toThrow('해제하지 못했어요');
  });
  it('알림 API 없는 브라우저에는 지원 불가를 반환한다', async () => {
    supported(); vi.stubGlobal('Notification', undefined);
    expect(await enableShiftPush()).toBe('unsupported');
    expect(mocks.user).not.toHaveBeenCalled();
  });
});
