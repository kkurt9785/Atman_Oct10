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

export async function getPlatformAdminSession(): Promise<AdminSession | null> {
  const session = await getAdminSession();
  if (!session || !isPlatformAdminEmail(session.user.email)) return null;
  return session;
}
