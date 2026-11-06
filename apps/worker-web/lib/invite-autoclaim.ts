// 초대 자동 수락 표시(초대 근무·사업장 직원 초대 공통).
// 로그인 전 초대 화면에서 '카카오로 가입하고 초대 수락'을 누른 그 초대만, 가입·로그인을 마치고 돌아왔을 때 한 번 자동으로 수락한다.
//  · 표시는 이 탭(sessionStorage)에만, 그 초대 토큰에만, 30분 동안만 남는다 — 링크만 열어 본 초대는 자동 수락하지 않는다
//  · 카카오톡 안 브라우저에서 남긴 표시는 외부 브라우저로 넘어가지 않는다. 거기서 버튼을 한 번 더 누르면 그때 남는다
export const INVITE_AUTOCLAIM_KEY = 'atman_gig_invite_autoclaim';
export const INVITE_AUTOCLAIM_TTL_MS = 30 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function tabStorage(): StorageLike | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function rememberInviteAutoclaim(token: string, storage: StorageLike | null = tabStorage(), now = Date.now()) {
  try { storage?.setItem(INVITE_AUTOCLAIM_KEY, JSON.stringify({ token, at: now })); } catch { /* 표시 없이 진행 — 돌아와서 한 번 더 누르면 된다 */ }
}

export function clearInviteAutoclaim(storage: StorageLike | null = tabStorage()) {
  try { storage?.removeItem(INVITE_AUTOCLAIM_KEY); } catch { /* 저장소 없음 */ }
}

// 이 초대에 대해 아직 유효한 표시가 있으면 true. 다른 초대·만료·깨진 표시는 여기서 지운다.
export function hasInviteAutoclaim(token: string, storage: StorageLike | null = tabStorage(), now = Date.now()) {
  let raw: string | null = null;
  try { raw = storage?.getItem(INVITE_AUTOCLAIM_KEY) ?? null; } catch { return false; }
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw) as { token?: unknown; at?: unknown };
    const age = typeof saved.at === 'number' ? now - saved.at : Number.NaN;
    if (saved.token === token && age >= 0 && age <= INVITE_AUTOCLAIM_TTL_MS) return true;
  } catch { /* 깨진 표시는 지운다 */ }
  clearInviteAutoclaim(storage);
  return false;
}

// 수락을 마친 초대. 아이폰에서 초대 화면을 연 채 홈 화면에 추가하면 앱이 늘 그 초대 화면에서 시작한다 —
// 이미 수락한 초대는 다시 묻지 않고 바로 내 근무로 연다(이 기기에만, 최근 10개).
export const CLAIMED_INVITES_KEY = 'atman_claimed_invites';

function deviceStorage(): StorageLike | null {
  try { return window.localStorage; } catch { return null; }
}

function claimedTokens(storage: StorageLike | null) {
  try {
    const parsed = JSON.parse(storage?.getItem(CLAIMED_INVITES_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

export function rememberClaimedInvite(token: string, storage: StorageLike | null = deviceStorage()) {
  const tokens = [token, ...claimedTokens(storage).filter((item) => item !== token)].slice(0, 10);
  try { storage?.setItem(CLAIMED_INVITES_KEY, JSON.stringify(tokens)); } catch { /* 표시 없이 진행 — 다음에 열면 초대 화면이 한 번 더 보인다 */ }
}

export function isClaimedInvite(token: string, storage: StorageLike | null = deviceStorage()) {
  return claimedTokens(storage).includes(token);
}
