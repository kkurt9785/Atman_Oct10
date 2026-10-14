import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ signOut: vi.fn().mockResolvedValue({}), setSession: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: mocks } }));
vi.mock('@/lib/worker-mode', () => ({ rememberWorkerShell: vi.fn(), setGigworkerModePreference: vi.fn() }));
vi.mock('@/lib/kakao-login', () => ({ startKakaoLogin: vi.fn() }));
vi.mock('@/lib/push-subscribe', () => ({ getExistingSubscription: vi.fn(), unsubscribeFromPush: vi.fn() }));
import { openDemoSession } from '../demo-session';
afterEach(() => vi.unstubAllGlobals());

describe('시연 이어하기 동선', () => {
  it.each([[true, '/gig'], [false, '/gig/join?token=demo-token']] as const)('진행 중=%s이면 %s로 이동한다', async (gigResume, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'test-token', refreshToken: 'test-refresh', gigInviteToken: 'demo-token', gigResume }) }));
    expect(await openDemoSession('gig')).toBe(expected);
  });
  it('준비 실패 시 잘못된 초대 화면으로 이동하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '시연 준비 실패' }) }));
    await expect(openDemoSession('gig')).rejects.toThrow('시연 준비 실패');
  });
});
