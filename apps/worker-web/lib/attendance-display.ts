type Settlement = { worked_minutes: number | null; break_minutes: number | null };

export function recordedShiftMinutes(value: Settlement | Settlement[] | null | undefined): number | null {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  if (rows.length === 0) return null;
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0].worked_minutes) || rows[0].worked_minutes! < 0
    || !Number.isSafeInteger(rows[0].break_minutes) || rows[0].break_minutes! < 0) {
    throw new Error('근태 정산 시간을 확인하지 못했어요.');
  }
  return rows[0].worked_minutes;
}

export function attendanceTime(iso: string | null) {
  return iso ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—';
}
