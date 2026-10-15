import { describe,it,expect } from 'vitest';
import { canOfferAttendanceQr,attendanceLocationHelp } from '../attendance-feedback';
describe('attendance policy aware recovery',()=>{
  it.each(['admin','network'])('does not suggest QR for %s',mode=>expect(canOfferAttendanceQr('GPS_ERROR',mode)).toBe(false));
  it.each(['GPS_ERROR','GPS_ACCURACY_LOW','OUT_OF_RANGE'])('does not bypass required GPS for %s',reason=>expect(canOfferAttendanceQr(reason,'gps_qr')).toBe(false));
  it('still offers a new QR for expired strengthened QR',()=>expect(canOfferAttendanceQr('QR_EXPIRED','gps_qr')).toBe(true));
  it('honors disabled fallback',()=>expect(canOfferAttendanceQr('GPS_ERROR','gps_or_qr',false)).toBe(false));
  it('explains both required factors',()=>expect(attendanceLocationHelp('gps_qr',true)).toContain('위치와 QR이 모두 필요'));
});
