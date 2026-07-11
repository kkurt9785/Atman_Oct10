import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

export type WagePaymentRow = {
  id: string; workerName: string; shiftDate: string; grossAmount: number; netAmount: number;
  deductionStatus: string; dueDate: string | null; status: string; approvedAt: string | null;
  paidAt: string | null; workerConfirmedAt: string | null; disputeReason: string | null;
};

export async function getWagePayments(): Promise<WagePaymentRow[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const { data, error } = await sb.from('wage_payment_instructions')
    .select('id,gross_amount,net_amount,deduction_status,due_date,status,approved_at,paid_at,worker_confirmed_at,dispute_reason,workers(name),shifts(shift_date)')
    .eq('facility_id', facilityId).order('created_at', { ascending: false }).limit(100);
  if (error) return [];
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id, workerName: row.workers?.name ?? '워커', shiftDate: row.shifts?.shift_date ?? '-',
    grossAmount: row.gross_amount, netAmount: row.net_amount, deductionStatus: row.deduction_status,
    dueDate: row.due_date, status: row.status, approvedAt: row.approved_at, paidAt: row.paid_at,
    workerConfirmedAt: row.worker_confirmed_at, disputeReason: row.dispute_reason,
  }));
}

export function hahrFeature(plan: string) { return plan === 'bundle' || plan === 'hr' || plan === 'growth' || plan === 'network'; }
