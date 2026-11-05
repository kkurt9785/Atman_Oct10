import { describe, expect, it } from 'vitest';
import { noticeDestination } from '../notification-destination';

const notice = (event_type: string, data: Record<string, unknown> | null) => ({ event_type, data });

describe('noticeDestination — 알림을 누르면 열 화면', () => {
  it('주소가 있으면 그 주소, 긱 셸은 같은 화면의 /gig 경로', () => {
    expect(noticeDestination(notice('shift.cover_requested', { url: '/cover', coverRequestId: 'c1' }), 'medical')).toBe('/cover');
    expect(noticeDestination(notice('workroom.message', { url: '/workroom?facility=f', kind: 'workroom.message' }), 'gig')).toBe('/gig/workroom?facility=f');
    expect(noticeDestination(notice('payout.due', { url: '/gig/settlement' }), 'gig')).toBe('/gig/settlement');
  });
  it('주소 없는 새 공고·긴급 공고는 그 공고 시트를 연다', () => {
    expect(noticeDestination(notice('shift.created', { type: 'new_shift', shiftId: 's1' }), 'medical')).toBe('/shifts?highlight=s1');
    expect(noticeDestination(notice('shift.urgent', { type: 'urgent_shift', shiftId: 's2' }), 'medical')).toBe('/shifts?highlight=s2');
    expect(noticeDestination(notice('shift.created', { type: 'new_shift' }), 'medical')).toBe('/shifts');
    expect(noticeDestination(notice('shift.batch_created', { type: 'new_shift_batch', batchId: 'b1' }), 'medical')).toBe('/shifts');
  });
  it('목록 주소만 적힌 알림도 그 공고·지원을 바로 연다', () => {
    expect(noticeDestination(notice('shift.created', { type: 'new_shift', shiftId: 's1', url: '/shifts' }), 'medical')).toBe('/shifts?highlight=s1');
    expect(noticeDestination(notice('shift.accepted', { type: 'accepted', applicationId: 'a1', shiftId: 's1', url: '/applications' }), 'medical')).toBe('/applications#application-a1');
    expect(noticeDestination(notice('shift.cancelled', { url: '/applications', shiftId: 's1' }), 'medical')).toBe('/applications');
    expect(noticeDestination(notice('shift.live_demo_ready', { type: 'new_shift', shiftId: 's1', url: '/shifts?highlight=s1' }), 'medical')).toBe('/shifts?highlight=s1');
  });
  it('반복근무 요청은 근무 찾기가 아니라 내 근무에서 수락한다', () => {
    expect(noticeDestination(notice('shift.invited', { type: 'new_shift', shiftId: 's1' }), 'medical')).toBe('/applications');
  });
  it('수락·확정(옛 알림은 주소 없음)은 내 근무, 채팅은 그 채팅방', () => {
    expect(noticeDestination(notice('shift.accepted', { type: 'accepted', applicationId: 'a1', shiftId: 's1' }), 'medical')).toBe('/applications#application-a1');
    expect(noticeDestination(notice('chat.message', { type: 'chat', applicationId: 'a1' }), 'medical')).toBe('/chat/a1');
    expect(noticeDestination(notice('shift.checkout', { type: 'checkout', attendanceId: 'x' }), 'medical')).toBe('/applications');
  });
  it('대타: 동료 요청은 대타 목록, 내 대타 확정은 내 근무', () => {
    expect(noticeDestination(notice('shift.cover_requested', { coverRequestId: 'c1', shiftId: 's1' }), 'medical')).toBe('/cover');
    expect(noticeDestination(notice('shift.cover_approved', { coverRequestId: 'c1' }), 'medical')).toBe('/applications');
  });
  it('주소 없는 근태 알림은 근태 화면(긱 셸은 /gig)', () => {
    expect(noticeDestination(notice('attendance.reminder', { kind: 'attendance.reminder', staff_id: 'st' }), 'medical')).toBe('/workplace');
    expect(noticeDestination(notice('attendance.reminder', { kind: 'attendance.reminder', staff_id: 'st' }), 'gig')).toBe('/gig');
  });
  it('모르는 종류·외부 주소는 열지 않는다', () => {
    expect(noticeDestination(notice('workroom.member_unlinked', { kind: 'workroom.member_unlinked', staffId: 'st' }), 'medical')).toBeNull();
    expect(noticeDestination(notice('test', { url: '//evil.example' }), 'medical')).toBeNull();
    expect(noticeDestination(notice('test', null), 'gig')).toBeNull();
    expect(noticeDestination(notice('chat.message', { type: 'chat', applicationId: '../x?y' }), 'medical')).toBe('/chat/..%2Fx%3Fy');
  });
});
