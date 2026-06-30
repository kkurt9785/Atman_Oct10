'use server';
import { cookies } from 'next/headers';
import { adminClient } from './supabase';
import { FACILITY_COOKIE } from './constants';

export async function getCurrentFacilityId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(FACILITY_COOKIE)?.value ?? null;
}

export async function setFacilityCookie(facilityId: string): Promise<void> {
  const jar = await cookies();
  jar.set(FACILITY_COOKIE, facilityId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30일
    path: '/',
  });
}

export async function claimFacility(facilityId: string, userId: string, inviteCode: string): Promise<{ ok: boolean; error?: string }> {
  const sb = adminClient();
  if (!sb) return { ok: false, error: '서버 오류' };

  const { data: existing } = await sb
    .from('facilities')
    .select('id, admin_user_id, invite_code')
    .eq('id', facilityId)
    .single();

  if (!existing) return { ok: false, error: '병원을 찾을 수 없어요' };
  if (existing.admin_user_id && existing.admin_user_id !== userId) {
    return { ok: false, error: '이미 다른 계정에서 연결된 병원이에요' };
  }
  if (!existing.invite_code || existing.invite_code.toUpperCase() !== inviteCode.trim().toUpperCase()) {
    return { ok: false, error: '초대 코드가 올바르지 않아요' };
  }

  const { error } = await sb
    .from('facilities')
    .update({ admin_user_id: userId })
    .eq('id', facilityId);

  if (error) return { ok: false, error: '연결 실패' };

  await setFacilityCookie(facilityId);
  return { ok: true };
}

export async function searchFacilities(query: string) {
  const sb = adminClient();
  if (!sb) return [];

  const { data } = await sb
    .from('facilities')
    .select('id, name, facility_type, address_text, admin_user_id')
    .ilike('name', `%${query}%`)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name')
    .limit(20);

  return data ?? [];
}
