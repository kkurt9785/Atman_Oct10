import { adminClient, ORG_ID } from '../supabase';

export type PayslipRow = {
  id: string;
  name: string;
  grossPay: number;
  netPay: number;
};

export async function getMonthPayslips(): Promise<PayslipRow[] | null> {
  const sb = adminClient();
  if (!sb || !ORG_ID) return null;

  const today       = new Date().toISOString().slice(0, 10);
  const periodStart = `${today.slice(0, 7)}-01`;

  // 먼저 payslips 테이블 시도
  const { data: slips } = await sb
    .from('payslips')
    .select('id, worker_id, gross_pay, net_pay, workers ( name )')
    .eq('org_id', ORG_ID)
    .eq('period_start', periodStart)
    .order('created_at', { ascending: false });

  if (slips && slips.length > 0) {
    return (slips as any[]).map((r) => ({
      id:       r.id,
      name:     r.workers?.name ?? '미상',
      grossPay: r.gross_pay,
      netPay:   r.net_pay,
    }));
  }

  // payslips 없으면 wage_calculations 집계
  const { data: wages } = await sb
    .from('wage_calculations')
    .select('worker_id, gross, workers ( name )')
    .eq('org_id', ORG_ID)
    .gte('calculated_at', `${periodStart}T00:00:00`);

  if (!wages || wages.length === 0) return null;

  // worker_id별 gross 합산
  const map: Record<string, { name: string; gross: number }> = {};
  for (const r of wages as any[]) {
    if (!map[r.worker_id]) {
      map[r.worker_id] = { name: r.workers?.name ?? '미상', gross: 0 };
    }
    map[r.worker_id].gross += r.gross ?? 0;
  }

  return Object.entries(map).map(([id, v]) => {
    const incomeTax = Math.round(v.gross * 0.03);
    const netPay    = v.gross - incomeTax - Math.round(incomeTax * 0.1);
    return { id, name: v.name, grossPay: v.gross, netPay };
  });
}

export function hahrFeature(plan: string) {
  return plan === 'bundle' || plan === 'hr';
}
