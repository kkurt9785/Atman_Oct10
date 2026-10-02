import { supabase } from './supabase';
import { nudgeAdminDispatch } from './shifts';

// 근무 대타 요청 — DB: supabase/migrations/20261002100000_shift_cover_requests.sql
//   확정 워커가 요청 → 같은 사업장 인력풀·동료가 맡음 → 사업장 승인 시 확정자 교체.
//   승인 전까지 그 근무는 원래 워커 몫이다.

export type CoverStatus = 'open' | 'claimed' | 'approved' | 'cancelled' | 'expired';

export type MyCover = {
  id: string;
  status: CoverStatus;
  application_id: string;
  shift_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  facility_name: string;
  claimer_name: string | null;
  created_at: string;
};

export type ClaimableCover = {
  id: string;
  shift_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  facility_name: string;
  department: string | null;
  required_role: string | null;
  hourly_wage: number;
  estimated_total_pay: number;
  claimed_by_me: boolean;
};

export type CoverResult = { ok: true } | { ok: false; message: string };

function failure(error: { message?: string } | null, fallback: string): CoverResult {
  return { ok: false, message: error?.message || fallback };
}

export async function listMyCovers(): Promise<MyCover[]> {
  const { data, error } = await supabase.rpc('list_my_shift_covers');
  return error ? [] : ((data ?? []) as MyCover[]);
}

export async function listClaimableCovers(): Promise<ClaimableCover[]> {
  const { data, error } = await supabase.rpc('list_claimable_shift_covers');
  return error ? [] : ((data ?? []) as ClaimableCover[]);
}

export async function requestCover(applicationId: string, reason: string): Promise<CoverResult> {
  const { error } = await supabase.rpc('request_shift_cover', { p_application_id: applicationId, p_reason: reason || null });
  if (error) return failure(error, '대타 요청을 보내지 못했어요.');
  void nudgeAdminDispatch();
  return { ok: true };
}

export async function cancelCover(requestId: string): Promise<CoverResult> {
  const { error } = await supabase.rpc('cancel_shift_cover', { p_request_id: requestId });
  if (error) return failure(error, '대타 요청을 취소하지 못했어요.');
  void nudgeAdminDispatch();
  return { ok: true };
}

export async function claimCover(requestId: string): Promise<CoverResult> {
  const { error } = await supabase.rpc('claim_shift_cover', { p_request_id: requestId });
  if (error) return failure(error, '대타를 맡지 못했어요. 잠시 후 다시 시도해 주세요.');
  void nudgeAdminDispatch();
  return { ok: true };
}
