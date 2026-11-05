import { describe, expect, it } from 'vitest';
import { loadPublicPostingBlock, publicPostingBlockReason, shiftStartPassed } from '../../../admin-web/lib/posting-gate';

// 직업안정법 §25(2026-12-10) — 공개 공고를 만드는 6경로가 같은 판정을 쓴다(2026-11-05 QA: 일반 등록 외 5경로 우회)
describe('publicPostingBlockReason', () => {
  const ok = { approved_at: '2026-10-01T00:00:00Z', registration_source: 'self_signup', business_status: 'active' };

  it('확인된 사업장·초대코드 사업장·국세청 미조회는 통과', () => {
    expect(publicPostingBlockReason(ok)).toBeNull();
    expect(publicPostingBlockReason({ approved_at: null, registration_source: 'invite', business_status: null })).toBeNull();
    expect(publicPostingBlockReason({ ...ok, business_status: null })).toBeNull();
  });

  it('셀프 등록 미승인은 막는다', () => {
    expect(publicPostingBlockReason({ ...ok, approved_at: null })).toMatch(/사업장 확인이 끝나면/);
  });

  it('국세청 휴업·폐업·미등록은 막는다', () => {
    expect(publicPostingBlockReason({ ...ok, business_status: 'closed' })).toMatch(/휴업·폐업/);
    expect(publicPostingBlockReason({ ...ok, business_status: 'suspended' })).toMatch(/휴업·폐업/);
    expect(publicPostingBlockReason({ ...ok, business_status: 'unknown' })).toMatch(/확인하지 못해/);
  });

  it('사업장 정보를 못 읽으면 막는다(실패 시 닫힘)', async () => {
    expect(publicPostingBlockReason(null)).toMatch(/확인하지 못했어요/);
    const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'down' } }) }) }) }) };
    expect(await loadPublicPostingBlock(failing as never, 'f')).toMatch(/확인하지 못했어요/);
  });
});

describe('shiftStartPassed', () => {
  const now = Date.parse('2026-11-05T13:29:00+09:00');
  it('KST 기준 시작 시각이 지났거나 지금이면 지난 근무', () => {
    expect(shiftStartPassed('2026-11-05', '09:00', now)).toBe(true);
    expect(shiftStartPassed('2026-11-05', '13:29', now)).toBe(true);
    expect(shiftStartPassed('2026-11-05', '15:30:00', now)).toBe(false);
    expect(shiftStartPassed('2026-11-06', '00:00', now)).toBe(false);
  });
  it('형식이 깨진 값은 지난 근무로 보지 않는다(다른 검증이 막는다)', () => {
    expect(shiftStartPassed('', '', now)).toBe(false);
  });
});
