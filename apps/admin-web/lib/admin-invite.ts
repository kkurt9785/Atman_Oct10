import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// 소유자가 직접 만드는 '운영 관리자 초대 링크'의 서명 토큰.
// 별도 테이블 없이 서명으로 위조를 막고, 한 번만 쓰이는지는 감사 기록(audit_logs)의 nonce 로 확인한다(lib/actions/facility.ts).
export const ADMIN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export type AdminInvite = { facilityId: string; issuedBy: string; nonce: string; expiresAt: string };

type Payload = { k: 'admin-invite'; f: string; i: string; n: string; e: number };

function secret(): string {
  const value = process.env.FACILITY_COOKIE_SECRET;
  if (!value || value.length < 32) throw new Error('FACILITY_COOKIE_SECRET must be configured with at least 32 characters');
  return value;
}

// 사업장 쿠키와 같은 키를 쓰므로 접두어로 용도를 갈라 서로 바꿔 쓸 수 없게 한다
function sign(body: string): string {
  return createHmac('sha256', secret()).update(`admin-invite.${body}`).digest('base64url');
}

export function issueAdminInvite(facilityId: string, issuedBy: string): AdminInvite & { token: string } {
  const nonce = randomBytes(12).toString('base64url');
  const exp = Date.now() + ADMIN_INVITE_TTL_MS;
  const payload: Payload = { k: 'admin-invite', f: facilityId, i: issuedBy, n: nonce, e: exp };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { token: `${body}.${sign(body)}`, facilityId, issuedBy, nonce, expiresAt: new Date(exp).toISOString() };
}

// 서명이 틀리거나 기한이 지났으면 null
export function readAdminInvite(token: string): AdminInvite | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    if (payload.k !== 'admin-invite' || !payload.f || !payload.i || !payload.n || !Number.isFinite(payload.e)) return null;
    if (Date.now() >= payload.e) return null;
    return { facilityId: payload.f, issuedBy: payload.i, nonce: payload.n, expiresAt: new Date(payload.e).toISOString() };
  } catch {
    return null;
  }
}
