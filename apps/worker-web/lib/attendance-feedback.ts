// QR은 시간·배정·중복 기록 오류를 해결하지 못한다.
export function canOfferAttendanceQr(reason?: string) {
  return ['OUT_OF_RANGE', 'GPS_ERROR', 'GPS_ACCURACY_LOW', 'QR_EXPIRED', 'QR_INVALID', 'HOSPITAL_MISMATCH'].includes(reason ?? '');
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
