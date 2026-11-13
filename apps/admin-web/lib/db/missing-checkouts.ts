import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { takeOldest, type MissingCheckout } from '../missing-checkouts';

type Joined<T> = T | T[] | null;
const first = <T,>(value: Joined<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value);

// 이 사업장의 퇴근 누락 — 직원 근태와 공고 근무를 합쳐 오래된 50건과 전체 건수를 준다.
// 조회가 실패해도 홈·근태 화면은 떠야 하므로 빈 목록을 돌려준다(호출하는 쪽에서 .catch 하지 않아도 됨).
export async function getMissingCheckouts(): Promise<{ items: MissingCheckout[]; total: number }> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return { items: [], total: 0 };
  const [staffResult, shiftResult] = await Promise.all([
    sb.from('staff_attendances')
      .select('id,work_date,check_in_at,scheduled_end,missing_checkout_at,facility_staff(name)', { count: 'exact' })
      .eq('facility_id', facilityId).not('missing_checkout_at', 'is', null).is('check_out_at', null)
      .order('work_date', { ascending: true }).order('check_in_at', { ascending: true }).limit(50),
    sb.from('shift_attendances')
      .select('id,check_in_at,missing_checkout_at,workers(name),shifts!inner(facility_id,shift_date,end_time)', { count: 'exact' })
      .eq('shifts.facility_id', facilityId).not('missing_checkout_at', 'is', null).is('check_out_at', null)
      .order('check_in_at', { ascending: true }).limit(50),
  ]);
  if (staffResult.error || shiftResult.error) return { items: [], total: 0 };

  const rows: MissingCheckout[] = [
    ...(staffResult.data ?? []).map((row) => ({
      id: row.id as string,
      kind: 'staff' as const,
      name: first(row.facility_staff as Joined<{ name: string | null }>)?.name ?? '이름 없음',
      workDate: row.work_date as string,
      checkInAt: row.check_in_at as string,
      scheduledEnd: (row.scheduled_end as string | null) ?? null,
      flaggedAt: row.missing_checkout_at as string,
    })),
    ...(shiftResult.data ?? []).map((row) => {
      const shift = first(row.shifts as Joined<{ shift_date: string; end_time: string | null }>);
      return {
        id: row.id as string,
        kind: 'shift' as const,
        name: first(row.workers as Joined<{ name: string | null }>)?.name ?? '이름 없음',
        workDate: shift?.shift_date ?? String(row.check_in_at).slice(0, 10),
        checkInAt: row.check_in_at as string,
        scheduledEnd: shift?.end_time ?? null,
        flaggedAt: row.missing_checkout_at as string,
      };
    }),
  ];
  return { items: takeOldest(rows), total: (staffResult.count ?? 0) + (shiftResult.count ?? 0) };
}
