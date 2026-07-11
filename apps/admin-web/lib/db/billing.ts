import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';
import { estimatedFacilityCharge } from '../billing';

export type BillingSummary = {
  balance: number;
  todayCommittedPay: number;
  upcomingCommittedPay: number;
  openExposurePay: number;
  todayMatchedCount: number;
  upcomingMatchedCount: number;
};

export async function getBillingSummary(): Promise<BillingSummary> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) {
    return {
      balance: 0,
      todayCommittedPay: 0,
      upcomingCommittedPay: 0,
      openExposurePay: 0,
      todayMatchedCount: 0,
      upcomingMatchedCount: 0,
    };
  }

  const today = todayKST();
  const [creditRes, shiftsRes] = await Promise.all([
    sb.rpc('org_credit_balance', { p_org_id: facilityId }),
    sb
      .from('shifts')
      .select('shift_date, estimated_total_pay, platform_fee_rate, status')
      .eq('facility_id', facilityId)
      .gte('shift_date', today)
      .in('status', ['open', 'matched', 'in_progress']),
  ]);

  const shifts = (shiftsRes.data ?? []) as Array<{
    shift_date: string;
    estimated_total_pay: number;
    platform_fee_rate: number | null;
    status: string;
  }>;

  const committed = shifts.filter((shift) => shift.status === 'matched' || shift.status === 'in_progress');
  const todayCommitted = committed.filter((shift) => shift.shift_date === today);
  const upcomingCommitted = committed.filter((shift) => shift.shift_date > today);
  const openShifts = shifts.filter((shift) => shift.status === 'open');

  return {
    balance: (creditRes.data as number) ?? 0,
    todayCommittedPay: todayCommitted.reduce((sum, shift) => sum + estimatedFacilityCharge(shift.estimated_total_pay, Number(shift.platform_fee_rate ?? 0.12)), 0),
    upcomingCommittedPay: upcomingCommitted.reduce((sum, shift) => sum + estimatedFacilityCharge(shift.estimated_total_pay, Number(shift.platform_fee_rate ?? 0.12)), 0),
    openExposurePay: openShifts.reduce((sum, shift) => sum + estimatedFacilityCharge(shift.estimated_total_pay, Number(shift.platform_fee_rate ?? 0.12)), 0),
    todayMatchedCount: todayCommitted.length,
    upcomingMatchedCount: upcomingCommitted.length,
  };
}
