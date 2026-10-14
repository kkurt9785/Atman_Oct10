// Mirrored from /packages/gig-pay/calculation.ts; keep both app copies in sync.
// Both apps use recorded breaks. Zero means no break; missing data must not
// silently deduct today's staff default from historical wages.
export function effectiveBreakMinutes(workedMinutes: number, rowBreak: number | null | undefined, _staffDefault?: number | null) {
  if (!Number.isFinite(workedMinutes) || workedMinutes <= 0) return 0;
  const value = Number(rowBreak ?? 0);
  return Number.isFinite(value) ? Math.min(workedMinutes, Math.max(0, value)) : 0;
}

export type RecordedAttendance = {
  work_date: string; status: string; check_in_at: string | null;
  check_out_at: string | null; break_minutes: number | null;
};

export function summarizeAttendancePeriod(rows: RecordedAttendance[], start: string, end: string) {
  let minutes = 0;
  const dates = new Set<string>();
  for (const row of rows) {
    if (row.work_date < start || row.work_date > end || row.status !== 'completed' || !row.check_in_at || !row.check_out_at) continue;
    const elapsed = Date.parse(row.check_out_at) - Date.parse(row.check_in_at);
    if (!Number.isFinite(elapsed) || elapsed < 0) continue;
    const raw = Math.round(elapsed / 60000);
    minutes += raw - effectiveBreakMinutes(raw, row.break_minutes);
    dates.add(row.work_date);
  }
  return { minutes, days: dates.size };
}

export function payoutDateKST(paidAt: string | null, payAt: string | null): string {
  if (!paidAt) return payAt ?? '';
  const milliseconds = Date.parse(paidAt);
  return Number.isFinite(milliseconds) ? new Date(milliseconds + 9 * 3600000).toISOString().slice(0, 10) : '';
}

export type PayoutCoverage = {
  attendance_ids: string[] | null;
  period_start: string;
  period_end: string;
  covered_until: string | null;
  status: string;
};
export type AttendanceIdentity = { id: string; work_date: string; check_out_at: string | null };

export function isAttendanceCovered(row: AttendanceIdentity, payouts: PayoutCoverage[]) {
  return payouts.some((payout) => {
    if (payout.status === 'cancelled') return false;
    if (payout.attendance_ids !== null) return payout.attendance_ids.includes(row.id);
    // Legacy payouts did not retain IDs. Keep their recorded date/time range;
    // never use a later payout as a blanket cutoff across cancelled periods.
    return row.check_out_at !== null && row.work_date >= payout.period_start && row.work_date <= payout.period_end
      && (payout.covered_until === null || Date.parse(row.check_out_at) <= Date.parse(payout.covered_until));
  });
}
