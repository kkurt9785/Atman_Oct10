// QR은 시간·배정·중복 기록 오류를 해결하지 못한다.
export function canOfferAttendanceQr(reason?: string, mode = 'gps_or_qr', qrFallback = true) {
  if (['gps','gps_or_qr'].includes(mode) && !qrFallback) return false;
  if (mode === 'admin' || mode === 'network') return false;
  if (mode === 'gps_qr' && ['OUT_OF_RANGE', 'GPS_ERROR', 'GPS_ACCURACY_LOW'].includes(reason ?? '')) return false;
  return ['OUT_OF_RANGE', 'GPS_ERROR', 'GPS_ACCURACY_LOW', 'QR_EXPIRED', 'QR_INVALID', 'HOSPITAL_MISMATCH'].includes(reason ?? '');
}

// 권한을 한 번 막으면 브라우저가 다시 묻지 않는다 — 어디서 켜는지와, 못 켜도 되는 다른 길(QR·Wi-Fi)을 같이 알려 준다(2026-11-11 단기 근로 QA).
export function attendanceLocationHelp(mode: string, denied: boolean, gig = false) {
  const who = gig ? '사장님께' : '관리자에게';
  const place = gig ? '근무지' : '사업장';
  const how = '주소창의 자물쇠(ⓘ) → 권한 → 위치를 허용으로 바꿔 주세요.';
  if (mode === 'gps_qr') return denied ? `강화 인증은 위치와 QR이 모두 필요해요. 휴대폰 위치 권한이 꺼져 있으면 ${how} 어려우면 ${who} 근태 확인을 요청해 주세요.` : `강화 인증에 필요한 위치를 확인하지 못했어요. 창가나 건물 밖에서 다시 눌러 보고, 어려우면 ${who} 확인을 요청해 주세요.`;
  return denied ? `위치를 쓸 수 없어요. 휴대폰 위치 권한이 꺼져 있으면 ${how} QR이나 ${place} Wi-Fi로도 인증할 수 있어요.` : `위치를 확인하지 못했어요. 다시 눌러 보거나 QR·${place} Wi-Fi로 인증해 주세요.`;
}

// 서버(record_unified_attendance)가 주는 실패 문구는 병원·약국 말투다. 초대 근무(/gig)에서는 상대가 '사장님', 장소가 '근무지'다.
export function attendanceFailureText(message: string | undefined, gig: boolean) {
  const text = (message ?? '출퇴근 인증에 실패했어요.').replace('QR 코드가 만료되었습니다.', 'QR이 만료됐어요.');
  if (!gig) return text;
  return text.replaceAll('관리자 화면', '사장님 화면').replaceAll('관리자에게', '사장님께').replaceAll('사업장에 ', '사장님께 ').replaceAll('사업장', '근무지');
}

export type GigAttendanceRecord = {
  staff_id: string; work_date: string; check_in_at: string | null; check_out_at: string | null;
  status?: string; break_minutes?: number;
};

export function currentGigAttendances(rows: GigAttendanceRecord[], today: string) {
  const result: Record<string, GigAttendanceRecord> = {};
  const ordered = [...rows].sort((a, b) => b.work_date.localeCompare(a.work_date));
  // 전날 시작한 야간 근무를 오늘 예정 행으로 가리지 않는다.
  for (const row of ordered) if (!result[row.staff_id] && row.check_in_at && !row.check_out_at) result[row.staff_id] = row;
  for (const row of ordered) if (!result[row.staff_id] && row.work_date === today) result[row.staff_id] = row;
  return result;
}
