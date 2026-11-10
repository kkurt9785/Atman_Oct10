import { describe, expect, it } from 'vitest';
import { inviteFailureAction } from '@/lib/invite-failure';

describe('inviteFailureAction — 초대 링크가 실패했을 때 갈 곳', () => {
  it('로그인 전이면 근무 찾기 첫 화면으로 보내지 않고 안내·로그인을 보여 준다', () => {
    expect(inviteFailureAction({ reason: 'INVALID', signedIn: false, linked: false })).toBe('ask_login');
    expect(inviteFailureAction({ reason: 'EXPIRED', signedIn: false, linked: false })).toBe('ask_login');
    expect(inviteFailureAction({ reason: undefined, signedIn: false, linked: false })).toBe('ask_login');
  });
  it('이미 그 근무지 종류에 연결된 사람이 쓴 초대를 다시 열면 내 근무로 간다', () => {
    expect(inviteFailureAction({ reason: 'INVALID', signedIn: true, linked: true })).toBe('open_home');
  });
  it('만료된 초대는 연결돼 있어도 알린다 — 수락된 적 없는 새 초대다', () => {
    expect(inviteFailureAction({ reason: 'EXPIRED', signedIn: true, linked: true })).toBe('show_error');
  });
  it('로그인했지만 연결이 없으면 실패 안내', () => {
    expect(inviteFailureAction({ reason: 'INVALID', signedIn: true, linked: false })).toBe('show_error');
  });
  it('시연 전용 초대는 누구에게나 그 안내를 보여 준다', () => {
    expect(inviteFailureAction({ reason: 'DEMO_ONLY', signedIn: false, linked: false })).toBe('show_error');
    expect(inviteFailureAction({ reason: 'DEMO_ONLY', signedIn: true, linked: true })).toBe('show_error');
  });
});
