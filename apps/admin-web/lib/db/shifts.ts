import { adminClient, ORG_ID } from '../supabase';

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

const MOCK_SHIFTS: ShiftRow[] = [
  {
    id: 'mock-1',
    shift_date: new Date().toISOString().slice(0, 10),
    start_time: '22:00',
    end_time: '06:00',
    is_overnight: true,
    required_role: 'rn',
    hourly_wage: 15000,
    estimated_total_pay: 120000,
    description: '심야 병동 간호 지원',
    department: '일반병동',
    notes: '식사 제공',
    status: 'open',
    created_at: new Date().toISOString(),
  },
];

export async function getShifts(): Promise<ShiftRow[]> {
  const sb = adminClient();
  if (!sb || !ORG_ID) return MOCK_SHIFTS;

  const { data } = await sb
    .from('shifts')
    .select(
      'id, shift_date, start_time, end_time, is_overnight, required_role, hourly_wage, estimated_total_pay, description, department, notes, status, created_at'
    )
    .eq('facility_id', ORG_ID)
    .order('shift_date', { ascending: false })
    .order('start_time', { ascending: true });

  return (data as ShiftRow[]) ?? MOCK_SHIFTS;
}

export async function createShift(payload: NewShift): Promise<void> {
  const sb = adminClient();
  if (!sb || !ORG_ID) return;

  const { error } = await sb.from('shifts').insert({
    ...payload,
    facility_id: ORG_ID,
  });

  if (error) throw new Error(error.message);
}
