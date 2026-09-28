import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { classifyNotice, noticeBelongsTo, noticeHref, type Notice } from '@/lib/notification-scope';

const ctx = (over: Partial<{ gigStaffIds: string[]; gigFacilityIds: string[]; hasGig: boolean; hasMedical: boolean }> = {}) => ({
  gigStaffIds: ['gig-staff'], gigFacilityIds: ['gig-fac'], hasGig: true, hasMedical: true, ...over,
});
const notice = (event_type: string, data: Record<string, unknown> | null = null): Notice => ({
  id: 'n', event_type, title: '', body: '', data, created_at: '', read_at: null,
});

describe('classifyNotice — 알림을 어느 셸에 보일지', () => {
  it('공고·지원·채팅·급여 알림은 의료 셸', () => {
    expect(classifyNotice(notice('application.accepted'), ctx())).toBe('medical');
    expect(classifyNotice(notice('chat.message', { staff_id: 'gig-staff' }), ctx())).toBe('medical');
  });
  it('근태·워크룸·지급 알림은 staff_id 로 가른다', () => {
    expect(classifyNotice(notice('workroom.direct', { staffId: 'gig-staff' }), ctx())).toBe('gig');
    expect(classifyNotice(notice('payout.paid', { staff_id: 'hospital-staff' }), ctx())).toBe('medical');
    expect(classifyNotice(notice('attendance.checkout_decided', { staff_id: 'gig-staff' }), ctx())).toBe('gig');
  });
  it('staff_id 없으면 facilityId, 그다음 application_id(단기 시프트 = 의료)', () => {
    expect(classifyNotice(notice('workroom.announcement', { facilityId: 'gig-fac' }), ctx())).toBe('gig');
    expect(classifyNotice(notice('workroom.announcement', { facilityId: 'hosp-fac' }), ctx())).toBe('medical');
    expect(classifyNotice(notice('attendance.reminder', { application_id: 'a1' }), ctx())).toBe('medical');
  });
  it('근무지를 특정 못 하면: 한쪽만 쓰면 그쪽, 둘 다면 양쪽 (알림을 잃지 않는다)', () => {
    expect(classifyNotice(notice('attendance.reminder'), ctx({ hasGig: true, hasMedical: false }))).toBe('gig');
    expect(classifyNotice(notice('attendance.reminder'), ctx({ hasGig: false, hasMedical: true }))).toBe('medical');
    expect(classifyNotice(notice('attendance.reminder'), ctx())).toBe('both');
  });
  it('noticeBelongsTo — both 는 어느 셸에서나 보인다', () => {
    expect(noticeBelongsTo('both', 'gig')).toBe(true);
    expect(noticeBelongsTo('gig', 'medical')).toBe(false);
  });
});

describe('noticeHref — DB 는 의료 경로만 적고 긱 셸이 바꿔 연다', () => {
  it('의료 셸은 그대로', () => {
    expect(noticeHref('/workroom?facility=f', 'medical')).toBe('/workroom?facility=f');
    expect(noticeHref('/workplace', 'medical')).toBe('/workplace');
  });
  it('긱 셸은 /workroom → /gig/workroom, /workplace → /gig', () => {
    expect(noticeHref('/workroom?facility=f', 'gig')).toBe('/gig/workroom?facility=f');
    expect(noticeHref('/workroom', 'gig')).toBe('/gig/workroom');
    expect(noticeHref('/workplace?attendanceToken=t', 'gig')).toBe('/gig?attendanceToken=t');
    expect(noticeHref('/gig/settlement', 'gig')).toBe('/gig/settlement');
  });
  it('외부·프로토콜 상대 주소는 열지 않는다', () => {
    expect(noticeHref('https://evil.example', 'gig')).toBeNull();
    expect(noticeHref('//evil.example', 'medical')).toBeNull();
    expect(noticeHref(null, 'gig')).toBeNull();
  });
});
