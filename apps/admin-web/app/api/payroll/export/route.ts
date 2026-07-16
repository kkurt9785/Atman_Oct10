import { getAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export async function GET() {
  const context = await getAdminContext();
  if (!context) return new Response('로그인이 필요합니다.', { status: 401 });
  if (context.accessRole !== 'owner' && context.accessRole !== 'super') {
    return new Response('급여 자료 내보내기 권한이 없습니다.', { status: 403 });
  }
  const sb = adminClient();
  if (!sb) return new Response('서버 설정 오류', { status: 500 });
  const { data, error } = await sb.from('wage_payment_instructions')
    .select('id,status,due_date,gross_amount,net_amount,deduction_status,bank_name_snapshot,account_last4_snapshot,paid_at,workers(name),shifts(shift_date,start_time,end_time)')
    .eq('facility_id', context.facilityId).order('created_at', { ascending: false }).limit(1000);
  if (error) return new Response('지급 자료를 불러오지 못했습니다.', { status: 500 });
  const header = ['지급요청ID','근무일','근무시간','워커','세전예상액','지급예정액','공제확인','지급상태','지급예정일','은행','계좌끝4자리','지급완료일'];
  const rows = ((data ?? []) as any[]).map((row) => [
    row.id, row.shifts?.shift_date, `${row.shifts?.start_time?.slice(0,5) ?? ''}~${row.shifts?.end_time?.slice(0,5) ?? ''}`,
    row.workers?.name ?? '워커', row.gross_amount, row.net_amount, row.deduction_status, row.status,
    row.due_date, row.bank_name_snapshot, row.account_last4_snapshot, row.paid_at,
  ]);
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="itdat-wage-review-${date}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
