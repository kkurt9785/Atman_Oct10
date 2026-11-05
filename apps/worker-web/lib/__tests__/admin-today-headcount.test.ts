import { describe, expect, it } from 'vitest';
import { attendanceReviewCount, todayHeadcount } from '../../../admin-web/lib/today-headcount';

// 2026-11-05 병원 QA P1 — 홈 '오늘 근무 N명'과 근태 '오늘 근무자' 탭이 같은 함수로 같은 숫자를 낸다
const staff = (id: string, attendanceStatus: string, over: Partial<{ workerId: string | null; scheduledToday: boolean }> = {}) =>
  ({ id, workerId: null, scheduledToday: true, attendanceStatus, ...over });

describe('오늘 근무 인원', () => {
  it('휴가자는 빼고 따로 센다', () => {
    expect(todayHeadcount([staff('a', 'scheduled'), staff('b', 'leave'), staff('c', 'working')], [])).toEqual({ working: 2, onLeave: 1 });
  });
  it('확인 필요(결근·조기 퇴근 승인 대기)는 오늘 근무에 넣는다', () => {
    expect(todayHeadcount([staff('a', 'absent'), staff('b', 'checkout_pending'), staff('c', 'completed')], []).working).toBe(3);
  });
  it('일정이 없고 기록도 없는 직원은 세지 않는다', () => {
    expect(todayHeadcount([staff('a', 'off', { scheduledToday: false }), staff('b', 'working', { scheduledToday: false })], []).working).toBe(1);
  });
  it('같은 사람의 직원 근태 + 공고 근무, 공고 2건은 1명이다', () => {
    const rows = [staff('s1', 'working', { workerId: 'w1' }), staff('s2', 'scheduled')];
    expect(todayHeadcount(rows, [{ id: 'w1' }, { id: 'w2' }, { id: 'w2' }]).working).toBe(3);
  });
  it('휴가 중이어도 오늘 공고 근무를 하면 근무자로 센다', () => {
    expect(todayHeadcount([staff('s1', 'leave', { workerId: 'w1' })], [{ id: 'w1' }])).toEqual({ working: 1, onLeave: 0 });
  });
});

describe('출퇴근 확인 건수', () => {
  it('조기 퇴근 승인 대기 + 미출근 + 인증 실패를 더한다', () => {
    expect(attendanceReviewCount([staff('a', 'checkout_pending'), staff('b', 'working')], 2, 1)).toBe(4);
  });
});
