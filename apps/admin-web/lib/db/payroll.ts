import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

export type WagePaymentRow = {
  id: string; workerName: string; shiftDate: string; grossAmount: number; netAmount: number;
  deductionStatus: string; dueDate: string | null; status: string; approvedAt: string | null;
  paidAt: string | null; workerConfirmedAt: string | null; disputeReason: string | null;
};

export type WagePaymentResult = { rows: WagePaymentRow[]; error: string | null };

export async function getWagePayments(): Promise<WagePaymentResult> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return { rows: [], error: '병원 또는 서버 연결 정보를 확인하지 못했어요.' };
  const { data, error } = await sb.from('wage_payment_instructions')
    .select('id,gross_amount,net_amount,deduction_status,due_date,status,approved_at,paid_at,worker_confirmed_at,dispute_reason,workers(name),shifts(shift_date)')
    .eq('facility_id', facilityId).order('created_at', { ascending: false }).limit(100);
  if (error) return { rows: [], error: '급여 지급 요청을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' };
  return { rows: ((data ?? []) as any[]).map((row) => ({
    id: row.id, workerName: row.workers?.name ?? '워커', shiftDate: row.shifts?.shift_date ?? '-',
    grossAmount: row.gross_amount, netAmount: row.net_amount, deductionStatus: row.deduction_status,
    dueDate: row.due_date, status: row.status, approvedAt: row.approved_at, paidAt: row.paid_at,
    workerConfirmedAt: row.worker_confirmed_at, disputeReason: row.dispute_reason,
  })), error: null };
}

export function hahrFeature(plan: string) { return plan === 'bundle' || plan === 'hr' || plan === 'growth' || plan === 'network'; }
