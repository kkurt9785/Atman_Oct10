import { describe, expect, it } from 'vitest';
import { parseInviteToken } from '../invite-link';

const TOKEN = '20260922-0000-4000-8000-000000000006';

describe('parseInviteToken', () => {
  it('링크 전체', () => {
    expect(parseInviteToken(`https://itdot.co.kr/gig/join?token=${TOKEN}`)).toBe(TOKEN);
  });
  it('토큰만', () => {
    expect(parseInviteToken(`  ${TOKEN} `)).toBe(TOKEN);
  });
  it('카톡 문자 전체를 복사해 와도 링크를 찾는다', () => {
    expect(parseInviteToken(`[잇닿] 팝업스토어 근무 초대예요\n아래 링크를 눌러 주세요\nhttps://itdot.co.kr/gig/join?token=${TOKEN}\n감사합니다`)).toBe(TOKEN);
  });
  it('링크가 없으면 null', () => {
    expect(parseInviteToken('안녕하세요')).toBeNull();
    expect(parseInviteToken('https://itdot.co.kr/')).toBeNull();
  });
});
