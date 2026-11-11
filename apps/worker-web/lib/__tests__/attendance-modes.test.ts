import { describe,it,expect } from 'vitest';
import { canOfferAttendanceQr,attendanceLocationHelp } from '../attendance-feedback';
describe('attendance policy aware recovery',()=>{
  it.each(['admin','network'])('does not suggest QR for %s',mode=>expect(canOfferAttendanceQr('GPS_ERROR',mode)).toBe(false));
  it.each(['GPS_ERROR','GPS_ACCURACY_LOW','OUT_OF_RANGE'])('does not bypass required GPS for %s',reason=>expect(canOfferAttendanceQr(reason,'gps_qr')).toBe(false));
  it('still offers a new QR for expired strengthened QR',()=>expect(canOfferAttendanceQr('QR_EXPIRED','gps_qr')).toBe(true));
  it('honors disabled fallback',()=>expect(canOfferAttendanceQr('GPS_ERROR','gps_or_qr',false)).toBe(false));
  it('explains both required factors',()=>expect(attendanceLocationHelp('gps_qr',true)).toContain('위치와 QR이 모두 필요'));
});

// 2026-11-11 단기 근로 QA: 초대 근무 화면에 병원 말투('사업장'·'관리자')와 합니다체가 그대로 나왔다
import { attendanceFailureText } from '../attendance-feedback';
describe('출퇴근 실패 문구', () => {
  it('초대 근무에서는 사장님·근무지로 바꾼다', () => {
    expect(attendanceFailureText('사업장에서 230m 떨어져 있어요.', true)).toBe('근무지에서 230m 떨어져 있어요.');
    expect(attendanceFailureText('그 밖의 시간은 사업장에 수동 기록을 요청해 주세요.', true)).toBe('그 밖의 시간은 사장님께 수동 기록을 요청해 주세요.');
    expect(attendanceFailureText('관리자에게 확인해 주세요.', true)).toBe('사장님께 확인해 주세요.');
  });
  it('병원·약국 화면은 그대로 두고, 합니다체 한 줄만 해요체로', () => {
    expect(attendanceFailureText('사업장에서 230m 떨어져 있어요.', false)).toBe('사업장에서 230m 떨어져 있어요.');
    expect(attendanceFailureText('QR 코드가 만료되었습니다.', false)).toBe('QR이 만료됐어요.');
    expect(attendanceFailureText(undefined, true)).toBe('출퇴근 인증에 실패했어요.');
  });
  it('위치 권한을 막았을 때 어디서 켜는지 알려 준다', () => {
    expect(attendanceLocationHelp('gps_or_qr', true, true)).toContain('권한 → 위치');
    expect(attendanceLocationHelp('gps_or_qr', true, true)).toContain('근무지 Wi-Fi');
    expect(attendanceLocationHelp('gps_or_qr', false)).toContain('사업장 Wi-Fi');
  });
});
