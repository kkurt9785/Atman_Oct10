import { describe, expect, it } from 'vitest';
import { countWorkDays, defaultWeekdaysFor, weekdaysInPeriod } from '../../../admin-web/lib/gig-period';

describe('근무 건 기간과 요일', () => {
  it('주말 이틀 행사는 토·일만 들어 있다', () => {
    expect(weekdaysInPeriod('2026-11-14', '2026-11-15')).toEqual([6, 7]);
  });
  it('월~금만 고른 채 토·일 기간이면 근무일이 0일이다', () => {
    expect(countWorkDays('2026-11-14', '2026-11-15', [1, 2, 3, 4, 5])).toBe(0);
    expect(countWorkDays('2026-11-13', '2026-11-15', [1, 2, 3, 4, 5])).toBe(1);
    expect(countWorkDays('2026-11-09', '2026-11-22', [1, 2, 3, 4, 5])).toBe(10);
  });
  it('엿새 이하 기간은 그 기간의 요일을 기본으로, 일주일 이상은 고른 요일 그대로', () => {
    expect(defaultWeekdaysFor('2026-11-14', '2026-11-15', [1, 2, 3, 4, 5])).toEqual([6, 7]);
    expect(defaultWeekdaysFor('2026-11-13', '2026-11-15', [1, 2, 3, 4, 5])).toEqual([5, 6, 7]);
    expect(defaultWeekdaysFor('2026-11-09', '2026-11-30', [1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
  });
  it('거꾸로 된 기간이나 잘못된 날짜는 빈 값', () => {
    expect(weekdaysInPeriod('2026-11-15', '2026-11-14')).toEqual([]);
    expect(countWorkDays('x', '2026-11-14', [1])).toBe(0);
    expect(defaultWeekdaysFor('x', 'y', [1, 2])).toEqual([1, 2]);
  });
});
