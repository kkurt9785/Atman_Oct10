import { describe, expect, it } from 'vitest';
import { HOLIDAYS, dayTone, holidayName, weekOf, weekday } from './holidays';

describe('korean calendar helpers', () => {
  it('knows substitute holidays and lunar holidays for 2026', () => {
    expect(holidayName('2026-03-02')).toBe('대체공휴일');
    expect(holidayName('2026-09-25')).toBe('추석');
    expect(holidayName('2026-06-03')).toBe('지방선거');
    expect(holidayName('2026-10-27')).toBeUndefined();
  });
  it('places substitute holidays on weekdays only', () => {
    for (const [date, name] of Object.entries(HOLIDAYS)) if (name === '대체공휴일') expect([1, 2, 3, 4, 5]).toContain(weekday(date));
  });
  it('tones holidays red before weekends and keeps saturdays blue', () => {
    expect(dayTone('2026-08-15')).toBe('holiday'); // 광복절 on a Saturday
    expect(dayTone('2026-10-31')).toBe('sat');
    expect(dayTone('2026-11-01')).toBe('sun');
    expect(dayTone('2026-10-27')).toBe('');
  });
  it('builds a sunday-first week around any date', () => {
    expect(weekOf('2026-10-27')).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    expect(weekOf('2026-11-01')[0]).toBe('2026-11-01');
  });
});
