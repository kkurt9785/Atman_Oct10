import { describe, expect, it } from 'vitest';
import { isMissingColumnError, isoWeekday, staffHoursOn, staffWorkDate } from '@/lib/staff-hours';

// 2026-11-09 = 월요일, 11-10 = 화요일, 11-14 = 토요일, 11-15 = 일요일
const dental = { default_start_time: '09:00', default_end_time: '18:00', weekday_hours: { '6': { start: '09:00', end: '13:00' } } };

describe('isoWeekday — 월=1 … 일=7 (서버 ISODOW 와 같은 번호)', () => {
  it('월요일은 1, 토요일은 6, 일요일은 7', () => {
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-14')).toBe(6);
    expect(isoWeekday('2026-11-15')).toBe(7);
  });
  it('날짜 형식이 아니면 null', () => {
    expect(isoWeekday('내일')).toBeNull();
  });
});

describe('staffHoursOn — 그 근무일의 예정 시간', () => {
  it('요일 값이 있는 날만 그 시간으로 바뀐다 (토요일 단축 근무)', () => {
    expect(staffHoursOn(dental, '2026-11-14')).toEqual({ start: '09:00', end: '13:00', custom: true });
    expect(staffHoursOn(dental, '2026-11-10')).toEqual({ start: '09:00', end: '18:00', custom: false });
  });
  it('컬럼이 없거나(null·undefined) 빈 객체면 기본 시간', () => {
    expect(staffHoursOn({ ...dental, weekday_hours: null }, '2026-11-14').custom).toBe(false);
    expect(staffHoursOn({ default_start_time: '09:00', default_end_time: '18:00' }, '2026-11-14').end).toBe('18:00');
    expect(staffHoursOn({ ...dental, weekday_hours: {} }, '2026-11-14').end).toBe('18:00');
  });
  it('형식이 어긋난 요일 값은 쓰지 않는다 — 시작≥종료(야간 넘김 없음), 시각이 아닌 글자, 한쪽만 있음', () => {
    const broken = (value: { start?: string | null; end?: string | null }) => staffHoursOn({ ...dental, weekday_hours: { '6': value } }, '2026-11-14');
    expect(broken({ start: '13:00', end: '09:00' }).custom).toBe(false);
    expect(broken({ start: '09:00', end: '09:00' }).custom).toBe(false);
    expect(broken({ start: '9시', end: '13:00' }).custom).toBe(false);
    expect(broken({ start: '09:00' }).custom).toBe(false);
    expect(broken({ start: '25:00', end: '26:00' }).custom).toBe(false);
  });
  it('초까지 적힌 값(HH:MM:SS)은 HH:MM 으로 읽는다', () => {
    expect(staffHoursOn({ ...dental, weekday_hours: { '6': { start: '09:00:00', end: '13:30:00' } } }, '2026-11-14')).toEqual({ start: '09:00', end: '13:30', custom: true });
  });
});

describe('staffWorkDate — 지금 속한 근무일(KST)', () => {
  it('주간 근무자는 한국 날짜 그대로 (UTC 로는 아직 전날이어도)', () => {
    expect(staffWorkDate(dental, new Date('2026-11-09T15:30:00Z'))).toBe('2026-11-10');
  });
  it('야간 근무자는 종료 시각 전까지 전날 근무다', () => {
    const night = { default_start_time: '22:00', default_end_time: '06:00' };
    expect(staffWorkDate(night, new Date('2026-11-10T03:00:00+09:00'))).toBe('2026-11-09');
    expect(staffWorkDate(night, new Date('2026-11-10T07:00:00+09:00'))).toBe('2026-11-10');
    expect(staffWorkDate(night, new Date('2026-11-10T23:00:00+09:00'))).toBe('2026-11-10');
  });
  it('야간 근무자도 서버와 같은 순서 — 근무일을 기본 시간으로 정한 뒤 그 근무일의 요일 값을 쓴다', () => {
    // 화요일 새벽 3시는 월요일 근무다 → 월요일(1) 값이 적용된다. 화요일(2) 값이 아니다
    const night = { default_start_time: '22:00', default_end_time: '06:00', weekday_hours: { '1': { start: '20:00', end: '23:00' }, '2': { start: '10:00', end: '12:00' } } };
    const workDate = staffWorkDate(night, new Date('2026-11-10T03:00:00+09:00'));
    expect(staffHoursOn(night, workDate)).toEqual({ start: '20:00', end: '23:00', custom: true });
  });
});

describe('isMissingColumnError — 마이그레이션보다 앱이 먼저 나갔을 때만 다시 읽는다', () => {
  it('없는 컬럼 오류만 참', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true);
    expect(isMissingColumnError({ code: '42501' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});
