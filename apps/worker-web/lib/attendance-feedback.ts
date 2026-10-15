// QR은 시간·배정·중복 기록 오류를 해결하지 못한다.
export function canOfferAttendanceQr(reason?: string, mode = 'gps_or_qr', qrFallback = true) {
  if (['gps','gps_or_qr'].includes(mode) && !qrFallback) return false;
  if (mode === 'admin' || mode === 'network') return false;
  if (mode === 'gps_qr' && ['OUT_OF_RANGE', 'GPS_ERROR', 'GPS_ACCURACY_LOW'].includes(reason ?? '')) return false;
  return ['OUT_OF_RANGE', 'GPS_ERROR', 'GPS_ACCURACY_LOW', 'QR_EXPIRED', 'QR_INVALID', 'HOSPITAL_MISMATCH'].includes(reason ?? '');
}

export function attendanceLocationHelp(mode: string, denied: boolean) {
  if (mode === 'gps_qr') return denied ? '강화 인증은 위치와 QR이 모두 필요해요. 위치정보 동의와 휴대폰 권한을 확인해 주세요. 해결되지 않으면 관리자에게 근태 확인을 요청하세요.' : '강화 인증에 필요한 위치를 확인하지 못했어요. 창가나 건물 밖에서 다시 시도하고, 어려우면 관리자에게 확인을 요청하세요.';
  return denied ? '위치정보 동의 또는 권한을 확인해 주세요. 허용된 경우 동적 QR이나 등록 네트워크로도 인증할 수 있어요.' : '위치를 확인하지 못했어요. 다시 시도하거나 사업장의 인증 규칙에 맞는 동적 QR·등록 네트워크를 이용해 주세요.';
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
