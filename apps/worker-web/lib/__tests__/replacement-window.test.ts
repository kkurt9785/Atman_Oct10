import { describe, expect, it } from 'vitest';
import { replacementWindow, REPLACEMENT_MIN_MINUTES } from '../../../admin-web/lib/replacement-window';

// 미출근 대체 근무는 '지금 + 30분'(10분 올림)부터 원래 종료까지 — 원래 시작 시각이면 이미 시작한 근무라 요청·수락·지원이 모두 거부된다
const at = (kst: string) => Date.parse(`${kst}+09:00`);

describe('replacementWindow', () => {
  it('07:00–15:00 근무에 07:35 요청 → 08:10–15:00', () => {
    expect(replacementWindow({ shift_date: '2026-11-05', start_time: '07:00:00', end_time: '15:00:00' }, at('2026-11-05T07:35:00')))
      .toEqual({ shiftDate: '2026-11-05', startTime: '08:10', endTime: '15:00', minutes: 410 });
  });
  it('정각 경계는 그대로(07:40 → 08:10)', () => {
    expect(replacementWindow({ shift_date: '2026-11-05', start_time: '07:00', end_time: '15:00' }, at('2026-11-05T07:40:00'))?.startTime).toBe('08:10');
  });
  it('야간 23:00–07:00, 자정 넘어 23:50 요청 → 다음 날 00:20–07:00', () => {
    expect(replacementWindow({ shift_date: '2026-11-05', start_time: '23:00', end_time: '07:00' }, at('2026-11-05T23:50:00')))
      .toEqual({ shiftDate: '2026-11-06', startTime: '00:20', endTime: '07:00', minutes: 400 });
  });
  it('12시간 야간 19:00–07:00, 19:40 요청 → 같은 날 20:10 시작(자정 넘김)', () => {
    expect(replacementWindow({ shift_date: '2026-11-05', start_time: '19:00', end_time: '07:00' }, at('2026-11-05T19:40:00')))
      .toMatchObject({ shiftDate: '2026-11-05', startTime: '20:10', endTime: '07:00' });
  });
  it(`남은 근무가 ${REPLACEMENT_MIN_MINUTES}분 미만이면 열지 않는다`, () => {
    expect(replacementWindow({ shift_date: '2026-11-05', start_time: '07:00', end_time: '15:00' }, at('2026-11-05T12:31:00'))).toBeNull();
    expect(replacementWindow({ shift_date: '2026-11-05', start_time: '07:00', end_time: '15:00' }, at('2026-11-05T12:30:00'))?.minutes).toBe(120);
  });
  it('원래 시작보다 앞당기지 않는다', () => {
    expect(replacementWindow({ shift_date: '2026-11-05', start_time: '14:00', end_time: '22:00' }, at('2026-11-05T09:00:00'))?.startTime).toBe('14:00');
  });
  it('형식이 틀리면 null', () => {
    expect(replacementWindow({ shift_date: '', start_time: '', end_time: '' })).toBeNull();
  });
});
