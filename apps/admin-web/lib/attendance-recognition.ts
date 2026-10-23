type Settlement = { worked_minutes: number | null; break_minutes: number | null };

/** Never substitute elapsed time for the recorded payroll recognition. */
export function shiftRecognition(value: Settlement | Settlement[] | null | undefined) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  if (rows.length > 1) throw new Error('중복된 근태 정산 기록을 확인해 주세요.');
  const row = rows[0];
  if (!row) return { workedMinutes: 0, breakMinutes: 0, recognitionPending: true };
  if (!Number.isSafeInteger(row.worked_minutes) || !Number.isSafeInteger(row.break_minutes)
    || row.worked_minutes! < 0 || row.break_minutes! < 0) {
    throw new Error('근태 정산 시간을 확인하지 못했어요.');
  }
  return { workedMinutes: row.worked_minutes!, breakMinutes: row.break_minutes!, recognitionPending: false };
}

export function attendancePersonKey(row: { id: string; staffId: string | null; workerId?: string | null }) {
  // Missing legacy identity must not merge unrelated workers by their display name.
  return row.staffId ? `staff:${row.staffId}` : row.workerId ? `worker:${row.workerId}` : `attendance:${row.id}`;
}
