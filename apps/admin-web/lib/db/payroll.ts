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

  const today = new Date().toISOString().slice(0, 10);
  const periodStart = `${today.slice(0, 7)}-01`;

  const { data } = await sb
    .from('payslips')
    .select('id, worker_id, gross_pay, net_pay, workers ( name )')
    .eq('org_id', ORG_ID)
    .eq('period_start', periodStart)
    .order('created_at', { ascending: false });

  if (!data || data.length === 0) return null;

  return (data as any[]).map((r) => ({
    id: r.id,
    name: r.workers?.name ?? '미상',
    grossPay: r.gross_pay,
    netPay: r.net_pay,
  }));
}

export function hahrFeature(plan: string) {
  return plan === 'bundle' || plan === 'hr';
}
