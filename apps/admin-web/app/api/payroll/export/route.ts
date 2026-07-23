import { getAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { getStaffWagePayments } from '@/lib/db/payroll';

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export async function GET(request:Request) {
  const context = await getAdminContext();
  if (!context) return new Response('로그인이 필요합니다.', { status: 401 });
  if (context.accessRole !== 'owner' && context.accessRole !== 'super') {
    return new Response('급여 자료 내보내기 권한이 없습니다.', { status: 403 });
  }
  const sb = adminClient();
  if (!sb) return new Response('서버 설정 오류', { status: 500 });
  const requested=new URL(request.url).searchParams.get('month')??'';
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)?requested:new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7);
  const next=new Date(`${month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const endDate=new Date(next.getTime()-86_400_000).toISOString().slice(0,10);
  const { data, error } = await sb.from('wage_payment_instructions')
    .select('id,status,due_date,gross_amount,net_amount,deduction_status,bank_name_snapshot,account_last4_snapshot,paid_at,workers(name),shifts!inner(shift_date,start_time,end_time)')
    .eq('facility_id', context.facilityId).gte('shifts.shift_date',`${month}-01`).lte('shifts.shift_date',endDate)
    .order('created_at', { ascending: false }).limit(1000);
  if (error) return new Response('지급 자료를 불러오지 못했습니다.', { status: 500 });
  const header = ['구분','지급요청ID','급여기간·근무일','근무시간','대상자','세전예상액','지급예정액','공제확인','지급상태','지급예정일','은행','계좌끝4자리','지급완료일'];
  const rows = ((data ?? []) as any[]).map((row) => [
    '공고 지원 인력', row.id, row.shifts?.shift_date, `${row.shifts?.start_time?.slice(0,5) ?? ''}~${row.shifts?.end_time?.slice(0,5) ?? ''}`,
    row.workers?.name ?? '워커', row.gross_amount, row.net_amount, row.deduction_status, row.status,
    row.due_date, row.bank_name_snapshot, row.account_last4_snapshot, row.paid_at,
  ]);
  const staffRows=await getStaffWagePayments(month);
  const managedRows=staffRows.map(row=>[
    '병원 등록 직원',`${row.staffId}:${row.periodMonth}`,row.periodMonth.slice(0,7),
    `${Math.floor(row.workedMinutes/60)}시간 ${row.workedMinutes%60}분`,row.workerName,
    row.grossAmount,row.netAmount,'미확정 · 병원 확인 필요',row.status,'',row.bankName,row.accountLast4,'',
  ]);
  const csv = `\uFEFF${[header, ...managedRows,...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="itdat-wage-review-${month}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
