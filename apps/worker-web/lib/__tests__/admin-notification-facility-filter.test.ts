import { describe, expect, it } from 'vitest';
import { noticeInFacility } from '../../../admin-web/lib/notification-destination';

// 2026-11-05 병원 QA P2 — W여성병원 알림 목록에 팝업스토어(다른 사업장) 알림이 섞였다
describe('관리자 알림 목록 사업장 거르기', () => {
  it('지금 사업장 알림은 보인다', () => expect(noticeInFacility({ facilityId: 'hospital' }, 'hospital')).toBe(true));
  it('다른 사업장 알림은 뺀다(snake case 포함)', () => {
    expect(noticeInFacility({ facilityId: 'popup' }, 'hospital')).toBe(false);
    expect(noticeInFacility({ facility_id: 'popup' }, 'hospital')).toBe(false);
  });
  it('사업장 정보가 없는 알림은 그대로 둔다', () => {
    expect(noticeInFacility(null, 'hospital')).toBe(true);
    expect(noticeInFacility({ url: '/applications' }, 'hospital')).toBe(true);
  });
  it('현재 사업장을 모르면 거르지 않는다', () => expect(noticeInFacility({ facilityId: 'popup' }, null)).toBe(true));
});
