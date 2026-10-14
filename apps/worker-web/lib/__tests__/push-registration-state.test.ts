import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), result: vi.fn(), subscription: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: mocks.user }, from: mocks.from } }));
vi.mock('../../../admin-web/lib/supabase-browser', () => ({ supabase: { auth: { getUser: mocks.user }, from: mocks.from } }));
import { isShiftPushEnabled } from '../push-subscribe';
const adminModule = '../../../admin-web/lib/push-subscribe';
const { isAdminPushEnabled } = await import(adminModule);

beforeEach(() => {
  vi.resetAllMocks();
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.result };
  mocks.from.mockReturnValue(query); mocks.select.mockReturnValue(query); mocks.eq.mockReturnValue(query);
  mocks.user.mockResolvedValue({ data: { user: { id: 'current-user' } }, error: null });
  mocks.result.mockResolvedValue({ data: { id: 'saved-subscription' }, error: null });
  mocks.subscription.mockResolvedValue({ endpoint: 'https://push.example/current-device' });
  vi.stubGlobal('window', { PushManager: function () {} });
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: mocks.subscription } }) } });
  vi.stubGlobal('Notification', { permission: 'granted' });
});
afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['워커', isShiftPushEnabled], ['관리자', isAdminPushEnabled],
] as const)('%s 알림 등록 상태', (_name, enabled: () => Promise<boolean>) => {
  it('기기 구독과 현재 사용자의 서버 행이 모두 있어야 켜짐이다', async () => {
    expect(await enabled()).toBe(true);
    expect(mocks.from).toHaveBeenCalledWith('push_subscriptions');
    expect(mocks.select).toHaveBeenCalledWith('id');
    expect(mocks.eq.mock.calls).toEqual([['worker_id', 'current-user'], ['endpoint', 'https://push.example/current-device']]);
  });
  it('기기 구독만 있고 서버 저장에 실패한 상태는 꺼짐이다', async () => {
    mocks.result.mockResolvedValue({ data: null, error: null });
    expect(await enabled()).toBe(false);
  });
  it('재로그인한 계정의 등록 여부로 다시 조회한다', async () => {
    await enabled();
    mocks.user.mockResolvedValue({ data: { user: { id: 'next-user' } }, error: null });
    mocks.result.mockResolvedValue({ data: null, error: null });
    expect(await enabled()).toBe(false);
    expect(mocks.eq).toHaveBeenCalledWith('worker_id', 'next-user');
    expect(mocks.user).toHaveBeenCalledTimes(2);
  });
  it('권한이 거절되면 서버에 이전 행이 있어도 꺼짐이다', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    expect(await enabled()).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('기기 구독이 없으면 다른 기기의 서버 등록을 조회하지 않는다', async () => {
    mocks.subscription.mockResolvedValue(null);
    expect(await enabled()).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('네트워크 오류는 꺼짐으로 단정하지 않고 호출 화면에 알린다', async () => {
    mocks.result.mockResolvedValue({ data: null, error: new Error('network') });
    await expect(enabled()).rejects.toThrow('network');
  });
  it('로그인이 만료되면 상태 확인 실패로 처리한다', async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    await expect(enabled()).rejects.toThrow('로그인');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('알림 API가 없으면 오류 없이 꺼짐을 반환한다', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(await enabled()).toBe(false);
  });
});
