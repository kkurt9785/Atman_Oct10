'use server';

import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { adminClient, getUserFromToken, userClient } from './supabase';
import { FACILITY_COOKIE } from './constants';

const ADMIN_SESSION_COOKIE = 'atman_admin_session';
const ADMIN_SESSION_MAX_AGE_SECONDS = 55 * 60;
const FACILITY_CONTEXT_MAX_AGE_SECONDS = 4 * 60 * 60;

export type AdminAccessRole = 'owner' | 'operator' | 'sales' | 'super';

export type AdminSession = {
  accessToken: string;
  user: User;
};

export type AdminContext = AdminSession & {
  facilityId: string;
  accessRole: AdminAccessRole;
};

type FacilityCookiePayload = {
  facilityId: string;
  userId: string;
  exp: number;
};

function cookieSecret(): string {
  const secret = process.env.FACILITY_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('FACILITY_COOKIE_SECRET must be configured with at least 32 characters');
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', cookieSecret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function encodeFacilityCookie(payload: FacilityCookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeFacilityCookie(value: string | undefined): FacilityCookiePayload | null {
  if (!value) return null;
  const [body, signature] = value.split('.');
  if (!body || !signature || !safeEqual(sign(body), signature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FacilityCookiePayload;
    if (!payload.facilityId || !payload.userId || !Number.isFinite(payload.exp)) return null;
    if (Date.now() >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function isAdminUser(accessToken: string, userId: string): Promise<boolean> {
  const sb = userClient(accessToken);
  if (!sb) return false;
  const { data, error } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  return !error && data?.role === 'admin';
}

export async function setAdminSessionCookie(accessToken: string): Promise<AdminSession> {
  const user = await getUserFromToken(accessToken);
  if (!user || !(await isAdminUser(accessToken, user.id))) {
    throw new Error('관리자 계정이 아닙니다.');
  }

  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
  return { accessToken, user };
}

export async function clearAdminCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_SESSION_COOKIE);
  jar.delete(FACILITY_COOKIE);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies();
  const accessToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!accessToken) return null;

  const user = await getUserFromToken(accessToken);
  if (!user || !(await isAdminUser(accessToken, user.id))) return null;
  return { accessToken, user };
}

export async function setFacilityContextCookie(
  facilityId: string,
  userId: string,
): Promise<void> {
  const jar = await cookies();
  const value = encodeFacilityCookie({
    facilityId,
    userId,
    exp: Date.now() + FACILITY_CONTEXT_MAX_AGE_SECONDS * 1000,
  });
  jar.set(FACILITY_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: FACILITY_CONTEXT_MAX_AGE_SECONDS,
    path: '/',
  });
}

export async function getFacilityAccessRole(
  userId: string,
  facilityId: string,
): Promise<AdminAccessRole | null> {
  const sb = adminClient();
  if (!sb) return null;

  const [{ data: owned }, { data: delegated }] = await Promise.all([
    sb
      .from('facilities')
      .select('id')
      .eq('id', facilityId)
      .eq('admin_user_id', userId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle(),
    sb
      .from('facility_admin_access')
      .select('access_role')
      .eq('user_id', userId)
      .eq('facility_id', facilityId)
      .maybeSingle(),
  ]);

  if (owned) return 'owner';
  const role = delegated?.access_role;
  return role === 'operator' || role === 'sales' || role === 'super' ? role : null;
}

export async function getAdminContext(): Promise<AdminContext | null> {
  const session = await getAdminSession();
  if (!session) return null;

  const jar = await cookies();
  const payload = decodeFacilityCookie(jar.get(FACILITY_COOKIE)?.value);
  if (!payload || payload.userId !== session.user.id) return null;

  const accessRole = await getFacilityAccessRole(session.user.id, payload.facilityId);
  if (!accessRole) return null;

  return {
    ...session,
    facilityId: payload.facilityId,
    accessRole,
  };
}

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new Error('관리자 로그인이 필요합니다.');
  return session;
}

export async function requireAdminContext(
  allowedRoles: AdminAccessRole[] = ['owner', 'operator', 'sales', 'super'],
): Promise<AdminContext> {
  const context = await getAdminContext();
  if (!context || !allowedRoles.includes(context.accessRole)) {
    throw new Error('이 병원에 대한 권한이 없습니다.');
  }
  return context;
}
