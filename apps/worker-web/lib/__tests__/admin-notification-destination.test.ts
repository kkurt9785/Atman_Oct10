import {describe,it,expect} from 'vitest';
import {adminNotificationDestination,safeFacilityDestination} from '../../../admin-web/lib/notification-destination';

describe('관리자 알림 현장 전환',()=>{
  it('현장 A 알림은 현재 쿠키와 무관하게 전환 경유로 연결한다',()=>{
    const url=new URL(adminNotificationDestination({facilityId:'site-a',url:'/operations#staffing-recommendations'}),'https://admin.test');
    expect(url.pathname).toBe('/notifications/open');
    expect(url.searchParams.get('facility')).toBe('site-a');
    expect(url.searchParams.get('next')).toBe('/operations#staffing-recommendations');
  });
  it('기존 snake case 필드와 근무자 필터를 보존한다',()=>{
    const url=new URL(adminNotificationDestination({facility_id:'site-a',url:'/gig-pay?staff=worker'}),'https://admin.test');
    expect(url.searchParams.get('next')).toBe('/gig-pay?staff=worker');
    expect(url.searchParams.get('facility')).toBe('site-a');
  });
  it.each(['https://evil.test','//evil.test','/api/set-facility','/%61pi/test','/notifications/open?next=/','/auth/callback','/foo/../api/test','/\\evil.test'])('위험한 목적지 %s 차단',value=>{
    expect(safeFacilityDestination(value)).toBe('/');
  });
  it('연차 신청 알림은 연차 화면으로 연다(예전엔 목록에 없어 홈으로 갔다)',()=>{
    const url=new URL(adminNotificationDestination({facilityId:'site-a',url:'/leave'}),'https://admin.test');
    expect(url.searchParams.get('next')).toBe('/leave');
    expect(safeFacilityDestination('/gig-work/abc')).toBe('/gig-work/abc');
  });
  it('등록 반려(/setup)는 지워진 사업장으로 전환하지 않고 바로 연다',()=>{
    expect(adminNotificationDestination({facility_id:'deleted-site',url:'/setup/claim-facility'})).toBe('/setup/claim-facility');
  });
  it('알림 정보가 없는 경우 안전한 홈으로',()=>expect(adminNotificationDestination(null)).toBe('/'));
});
