import { describe, expect, it } from 'vitest';
import { workerGuideOpen, WORKER_GUIDE_DAYS, guideKey, guideFirstKey } from '../guide-window';
import { adminGuideLastDay, guideOpenOn, ADMIN_GUIDE_DAYS } from '../../../admin-web/lib/guide-window';

const DAY = 86_400_000;

describe('근무자 사용 안내 기간', () => {
  it('처음 보는 사람에게는 보인다', () => { expect(workerGuideOpen(1_000, null, false)).toBe(true); });
  it('닫으면 기간 안이어도 안 보인다', () => { expect(workerGuideOpen(1_000, 500, true)).toBe(false); });
  it(`처음 본 날부터 ${WORKER_GUIDE_DAYS}일이 되기 전까지만 보인다`, () => {
    const first = 1_700_000_000_000;
    expect(workerGuideOpen(first + 13 * DAY + DAY - 1, first, false)).toBe(true);
    expect(workerGuideOpen(first + 14 * DAY, first, false)).toBe(false);
  });
  it('저장 값이 깨졌으면 처음 보는 것으로 본다', () => { expect(workerGuideOpen(1_000, Number.NaN, false)).toBe(true); });
  it('닫은 기록과 처음 본 기록은 다른 키를 쓴다', () => { expect(guideKey('a')).not.toBe(guideFirstKey('a')); });
});

describe('관리자 사용 안내 기간', () => {
  it('시연 사업장은 기간 없이 보인다', () => {
    expect(guideOpenOn('2030-01-01', adminGuideLastDay({ isDemo: true }))).toBe(true);
  });
  it(`등록 후 ${ADMIN_GUIDE_DAYS}일째 되는 날까지 보이고 다음 날 사라진다(한국 날짜 기준)`, () => {
    // 2026-11-14 23:30 KST 등록 = UTC 14:30
    const last = adminGuideLastDay({ createdAt: '2026-11-14T14:30:00Z' });
    expect(last).toBe('2026-12-14');
    expect(guideOpenOn('2026-12-14', last)).toBe(true);
    expect(guideOpenOn('2026-12-15', last)).toBe(false);
  });
  it('한국 시간으로 자정을 넘긴 등록은 다음 날부터 센다', () => {
    expect(adminGuideLastDay({ createdAt: '2026-11-14T15:30:00Z' })).toBe('2026-12-15');
  });
  it('체험 종료일이 더 늦으면 체험 종료일까지 보인다', () => {
    expect(adminGuideLastDay({ createdAt: '2026-11-01T00:00:00Z', trialEndsAt: '2027-01-31' })).toBe('2027-01-31');
  });
  it('체험이 먼저 끝나도 등록 후 30일은 보인다', () => {
    expect(adminGuideLastDay({ createdAt: '2026-11-01T00:00:00Z', trialEndsAt: '2026-11-10' })).toBe('2026-12-01');
  });
  it('기준을 알 수 없으면 안내를 띄우지 않는다', () => {
    expect(adminGuideLastDay({})).toBeNull();
    expect(guideOpenOn('2026-11-11', null)).toBe(false);
    expect(adminGuideLastDay({ createdAt: '엉뚱한 값', trialEndsAt: '' })).toBeNull();
  });
});
