import { SHIFT_ROLE_LABEL, type ShiftRole } from './roles';

export type PublicShift = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  created_at: string;
  hourly_wage: number;
  required_role: string;
  department: string | null;
  description: string | null;
  facility_name: string;
  facility_type: string;
  region: string | null;
};

export type PublicShiftDetail = PublicShift & {
  estimated_total_pay: number | null;
};

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 공개 RPC는 SECURITY DEFINER로 필요한 필드만 반환한다 (연락처·좌표·데모 제외)
async function rpc<T>(fn: string, body: Record<string, unknown>, revalidate = 300): Promise<T[]> {
  if (!URL || !KEY) return [];
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      next: { revalidate },
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  }
}

export async function listPublicShifts(limit = 50): Promise<PublicShift[]> {
  return rpc<PublicShift>('list_public_shifts', { p_limit: limit });
}

export async function getPublicShift(id: string): Promise<PublicShiftDetail | null> {
  const rows = await rpc<PublicShiftDetail>('get_public_shift', { p_id: id });
  return rows[0] ?? null;
}

export const roleLabel = (role: string) =>
  SHIFT_ROLE_LABEL[role as ShiftRole] ?? '의료 인력';

export const facilityLabel = (type: string) =>
  type === 'pharmacy' ? '약국' : type === 'care_hospital' ? '요양병원' : '병원·의원';

export function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const week = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${week})`;
}

export const hhmm = (t: string) => t?.slice(0, 5) ?? '';

export function shiftHours(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 10) / 10;
}
