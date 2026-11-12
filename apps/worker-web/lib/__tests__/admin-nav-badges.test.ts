import { describe, expect, it } from 'vitest';
import { badgeText, countUnreadMessages } from '../../../admin-web/lib/nav-badges';

const ADMIN = 'admin-1';
const msg = (staff_id: string | null, created_at: string, sender_user_id: string | null = 'worker-1', sender_type = 'worker') => ({ staff_id, created_at, sender_user_id, sender_type });

describe('하단 탭 대화 숫자', () => {
  it('1:1 대화는 그 대화방을 읽은 뒤에 온 근무자 메시지만 센다', () => {
    const reads = [{ staff_id: 's1', last_read_at: '2026-11-12T01:00:00Z' }];
    expect(countUnreadMessages([msg('s1', '2026-11-12T00:59:00Z'), msg('s1', '2026-11-12T01:01:00Z')], reads, null, ADMIN)).toBe(1);
  });
  it('한 번도 안 연 대화방의 근무자 메시지는 모두 센다', () => {
    expect(countUnreadMessages([msg('s2', '2026-11-12T01:00:00Z'), msg('s2', '2026-11-12T02:00:00Z')], [], null, ADMIN)).toBe(2);
  });
  it('전체 공지방은 사업장 읽은 시각과 비교한다', () => {
    expect(countUnreadMessages([msg(null, '2026-11-12T03:00:00Z'), msg(null, '2026-11-12T01:00:00Z')], [], '2026-11-12T02:00:00Z', ADMIN)).toBe(1);
  });
  it('내가 보낸 것과 시스템 안내는 세지 않는다', () => {
    expect(countUnreadMessages([msg('s1', '2026-11-12T05:00:00Z', ADMIN, 'admin'), msg('s1', '2026-11-12T05:00:00Z', null, 'system')], [], null, ADMIN)).toBe(0);
  });
  it('시각 표기가 달라도(+09:00 vs Z) 같은 순간이면 읽은 것으로 본다', () => {
    const reads = [{ staff_id: 's1', last_read_at: '2026-11-12T10:00:00+09:00' }];
    expect(countUnreadMessages([msg('s1', '2026-11-12T01:00:00Z')], reads, null, ADMIN)).toBe(0);
  });
});

describe('배지 글자', () => {
  it('0이나 이상한 값은 그리지 않는다', () => { expect(badgeText(0)).toBe(''); expect(badgeText(-3)).toBe(''); expect(badgeText(Number.NaN)).toBe(''); });
  it('100 이상은 99+', () => { expect(badgeText(7)).toBe('7'); expect(badgeText(100)).toBe('99+'); });
});
