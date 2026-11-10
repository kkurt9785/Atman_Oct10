import { getAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { getStaffWagePayments } from '@/lib/db/payroll';
import { readAllRows } from '@/lib/db/read-all-rows';
import { PAYROLL_EXPORT_HEADER, shiftExportRow, staffExportRow } from '@/lib/payroll-export';
import { getAttendanceHistory } from '@/lib/db/attendance-history';
import { kstDate, staffMonthStats } from '@/lib/attendance-export';
// 대상자 이름·은행명이 = + - @ 로 시작해도 수식으로 열리지 않게 공용 칸 함수를 쓴다
import { csvAttachment, csvCell } from '@/lib/csv';

export async function GET(request:Request) {
  const context = await getAdminContext();
  if (!context) return new Response('로그인이 필요해요.', { status: 401 });
  if ((context.accessRole !== 'owner' && context.accessRole !== 'super') || !context.canViewPayroll) {
    return new Response('급여 자료를 내보낼 권한이 없어요.', { status: 403 });
  }
  const sb = adminClient();
  if (!sb) return new Response('서버 설정 오류', { status: 500 });
  const requested=new URL(request.url).searchParams.get('month')??'';
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)?requested:new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);
  const next=new Date(`${month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const endDate=new Date(next.getTime()-86_400_000).toISOString().slice(0,10);
  let data: any[];
  try {
    ({ data } = await readAllRows(() => sb.from('wage_payment_instructions')
      .select('id,created_at,status,due_date,gross_amount,net_amount,deduction_status,bank_name_snapshot,account_last4_snapshot,paid_at,workers(name),shifts!inner(shift_date,start_time,end_time)')
      .eq('facility_id', context.facilityId).gte('shifts.shift_date',`${month}-01`).lte('shifts.shift_date',endDate)));
  } catch {
    return new Response('지급 자료 전체를 확인하지 못해 내보내기를 중단했어요.', { status: 500 });
  }
  data.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  const rows = ((data ?? []) as any[]).map((row) => shiftExportRow({
    shiftDate: row.shifts?.shift_date, startTime: row.shifts?.start_time, endTime: row.shifts?.end_time, workerName: row.workers?.name,
    grossAmount: row.gross_amount, netAmount: row.net_amount, deductionStatus: row.deduction_status, status: row.status, dueDate: row.due_date,
    bankName: row.bank_name_snapshot, accountLast4: row.account_last4_snapshot, paidDate: kstDate(row.paid_at),
  }));
  // 직원 행에는 그 달 근태 요약(출근일수·지각·조퇴·결근)과 승인된 휴가 사용일을 붙인다. 하나라도 못 읽으면 일부만 담지 않고 중단
  let staffRows: Awaited<ReturnType<typeof getStaffWagePayments>>;
  let stats: ReturnType<typeof staffMonthStats>;
  const leaveMinutes = new Map<string, number>();
  try {
    const [payments, history, leaves] = await Promise.all([
      getStaffWagePayments(month),
      getAttendanceHistory(month),
      readAllRows(() => sb.from('staff_leave_requests').select('id,staff_id,requested_minutes')
        .eq('facility_id', context.facilityId).eq('status', 'approved').gte('start_date', `${month}-01`).lte('start_date', endDate)),
    ]);
    staffRows = payments;
    stats = staffMonthStats(history.rows);
    for (const leave of (leaves.data ?? []) as Array<{ staff_id: string; requested_minutes: number }>) {
      leaveMinutes.set(leave.staff_id, (leaveMinutes.get(leave.staff_id) ?? 0) + Number(leave.requested_minutes ?? 0));
    }
  }
  catch { return new Response('직원 급여 자료 전체를 확인하지 못해 내보내기를 중단했어요.', { status: 500 }); }
  const managedRows = staffRows.map((row) => staffExportRow(row, stats.get(row.staffId), leaveMinutes.get(row.staffId) ?? 0));
  const header = PAYROLL_EXPORT_HEADER;
  const csv = `\uFEFF${[header, ...managedRows,...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': csvAttachment(`payroll-review-${month}.csv`, `급여검토_${month}.csv`),
      'cache-control': 'no-store',
    },
  });
}
