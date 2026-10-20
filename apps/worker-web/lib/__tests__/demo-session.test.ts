import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getSession:vi.fn().mockResolvedValue({data:{session:null},error:null}), signOut: vi.fn().mockResolvedValue({}), setSession: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: mocks } }));
vi.mock('@/lib/worker-mode', () => ({ rememberWorkerShell: vi.fn(), setGigworkerModePreference: vi.fn() }));
vi.mock('@/lib/kakao-login', () => ({ startKakaoLogin: vi.fn() }));
vi.mock('@/lib/push-subscribe', () => ({ getExistingSubscription: vi.fn(), unsubscribeFromPush: vi.fn() }));
import { openDemoSession } from '../demo-session';
afterEach(() => {vi.unstubAllGlobals();vi.clearAllMocks();mocks.getSession.mockResolvedValue({data:{session:null},error:null});});

describe('시연 이어하기 동선', () => {
  it.each([[true, '/gig'], [false, '/gig/join?token=demo-token']] as const)('진행 중=%s이면 %s로 이동한다', async (gigResume, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'test-token', refreshToken: 'test-refresh', gigInviteToken: 'demo-token', gigResume }) }));
    expect(await openDemoSession('gig')).toBe(expected);
  });
  it('준비 실패 시 잘못된 초대 화면으로 이동하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '시연 준비 실패' }) }));
    await expect(openDemoSession('gig')).rejects.toThrow('시연 준비 실패');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });
  it('실계정 전환 취소는 기존 로그인과 데이터를 유지한다',async()=>{
    mocks.getSession.mockResolvedValue({data:{session:{user:{email:'real@example.test'}}},error:null});
    vi.stubGlobal('window',{confirm:vi.fn(()=>false)});
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(openDemoSession('gig')).rejects.toThrow('취소');
    expect(fetch).not.toHaveBeenCalled();expect(mocks.signOut).not.toHaveBeenCalled();expect(mocks.setSession).not.toHaveBeenCalled();
  });
  it('연속 클릭은 한 번만 준비하고 의료 홈으로 이동한다',async()=>{
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({accessToken:'token',refreshToken:'refresh'})});vi.stubGlobal('fetch',fetch);
    const target={email:'worker-demo-1@demo.atman.co.kr'};
    expect(await Promise.all([openDemoSession(target),openDemoSession(target)])).toEqual(['/home','/home']);
    expect(fetch).toHaveBeenCalledTimes(1);expect(mocks.setSession).toHaveBeenCalledTimes(1);expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
