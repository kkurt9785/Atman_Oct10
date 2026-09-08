import { getAdminSession, type AdminSession } from './admin-auth';

// 잇닿 운영자(플랫폼 관리자) 게이트. 별도 role 없이 환경변수 이메일 목록으로 판정한다.
// PLATFORM_ADMIN_EMAILS="a@x.com,b@y.com" — 데모 계정은 절대 넣지 않는다(데모 로그인이 공개돼 있음).
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return platformAdminEmails().includes(e) && !e.endsWith('@demo.atman.co.kr');
}

// 카카오 로그인은 이메일 동의가 없으면 email이 NULL로 들어온다 → 사용자 ID로도 지정할 수 있게 한다.
// PLATFORM_ADMIN_USER_IDS="uuid,uuid"
export function platformAdminUserIds(): string[] {
  return (process.env.PLATFORM_ADMIN_USER_IDS ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

export function isPlatformAdminUser(user: { id: string; email?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return isPlatformAdminEmail(user.email) || platformAdminUserIds().includes(user.id.toLowerCase());
}

export async function getPlatformAdminSession(): Promise<AdminSession | null> {
  const session = await getAdminSession();
  if (!session || !isPlatformAdminUser(session.user)) return null;
  return session;
}
