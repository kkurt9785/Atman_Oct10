import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST, yesterdayKST } from '../date';

export type ShiftRow = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  required_role: 'rn' | 'na' | 'any';
  hourly_wage: number;
  estimated_total_pay: number;
  description: string;
  department: string | null;
  notes: string | null;
  status: 'open' | 'matched' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
};

export type NewShift = Omit<ShiftRow, 'id' | 'is_overnight' | 'status' | 'created_at'>;

const SELECT_COLS = 'id, shift_date, start_time, end_time, is_overnight, required_role, hourly_wage, estimated_total_pay, description, department, notes, status, created_at';

export async function getShifts(): Promise<ShiftRow[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];

  const today = todayKST();

  // 오늘 이후 시프트 + 근무 진행 중인 것만
  const { data } = await sb
    .from('shifts')
    .select(SELECT_COLS)
    .eq('facility_id', facilityId)
    .or(`shift_date.gte.${today},status.eq.in_progress`)
    .not('status', 'eq', 'cancelled')
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true });

  return (data as ShiftRow[]) ?? [];
}

// 만료됐는데 매칭 못 된 시프트 (어제 이전 + open 상태)
export async function getExpiredOpenShifts(): Promise<ShiftRow[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];

  const yesterday = yesterdayKST();

  const { data } = await sb
    .from('shifts')
    .select(SELECT_COLS)
    .eq('facility_id', facilityId)
    .eq('status', 'open')
    .lte('shift_date', yesterday)
    .order('shift_date', { ascending: false })
    .limit(10);

  return (data as ShiftRow[]) ?? [];
}

export async function createShift(payload: NewShift): Promise<void> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) throw new Error('인증 필요');

  const { error } = await sb.from('shifts').insert({
    ...payload,
    facility_id: facilityId,
  });

  if (error) throw new Error(error.message);
}
