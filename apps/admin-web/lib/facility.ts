'use server';
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { adminClient, getUserFromToken } from './supabase';
import { FACILITY_COOKIE } from './constants';
import { grantOnboardingCredit } from './credits';

function cookieSecret(): string | null {
  return process.env.FACILITY_COOKIE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

function signFacilityId(facilityId: string): string | null {
  const secret = cookieSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(facilityId).digest('base64url');
}

function verifySignedFacilityCookie(value: string | undefined): string | null {
  if (!value) return null;
  const [facilityId, signature] = value.split('.');
  if (!facilityId || !signature) return null;

  const expected = signFacilityId(facilityId);
  if (!expected) return null;

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(actualBuffer, expectedBuffer) ? facilityId : null;
}

export async function getCurrentFacilityId(): Promise<string | null> {
  const jar = await cookies();
  return verifySignedFacilityCookie(jar.get(FACILITY_COOKIE)?.value);
}

export async function setFacilityCookie(facilityId: string): Promise<void> {
  const jar = await cookies();
  const signature = signFacilityId(facilityId);
  if (!signature) throw new Error('FACILITY_COOKIE_SECRET is not configured');
  jar.set(FACILITY_COOKIE, `${facilityId}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30일
    path: '/',
  });
}

export async function claimFacility(facilityId: string, accessToken: string, inviteCode: string): Promise<{ ok: boolean; error?: string }> {
  const sb = adminClient();
  if (!sb) return { ok: false, error: '서버 오류' };
  const user = await getUserFromToken(accessToken);
  if (!user) return { ok: false, error: '로그인이 필요해요' };

  const { data: existing } = await sb
    .from('facilities')
    .select('id, admin_user_id, invite_code')
    .eq('id', facilityId)
    .single();

  if (!existing) return { ok: false, error: '병원을 찾을 수 없어요' };
  if (existing.admin_user_id && existing.admin_user_id !== user.id) {
    return { ok: false, error: '이미 다른 계정에서 연결된 병원이에요' };
  }
  if (!existing.invite_code || existing.invite_code.toUpperCase() !== inviteCode.trim().toUpperCase()) {
    return { ok: false, error: '초대 코드가 올바르지 않아요' };
  }

  const { error } = await sb
    .from('facilities')
    .update({ admin_user_id: user.id })
    .eq('id', facilityId);

  if (error) return { ok: false, error: '연결 실패' };

  await setFacilityCookie(facilityId);
  await grantOnboardingCredit(sb, facilityId, 'onboard_signup');
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
