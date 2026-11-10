// 초대 미리보기가 실패했을 때(만료·잘못된 주소·이미 쓴 초대) 무엇을 할지.
// 서버(get_facility_staff_invite_preview)는 '이미 수락한 초대'와 '없는 초대'를 같은 INVALID 로 돌려준다 — 토큰만으로는 구분할 수 없다.
// 그래서 로그인한 사람이 이미 그 종류의 근무지에 연결돼 있으면 '내가 수락한 초대'로 보고 근무 화면을 연다.
// 아이폰에서 초대 화면째 홈 화면에 추가한 앱은 열 때마다 이 초대 주소에서 시작하는데(lib/install-manifest.ts),
// 기기 기록(isClaimedInvite)이 지워졌거나 다른 기기에서 수락했으면 실패 화면에 갇혔다(2026-11-10 치과 QA P1-14).
export type InviteFailureAction =
  // 이미 연결된 사람 — 실패 화면 대신 내 근무(/workplace · /gig)로
  | 'open_home'
  // 로그인 전 — 근무 찾기 첫 화면으로 보내지 않고, 새 링크 요청 안내와 로그인 버튼을 보여 준다
  | 'ask_login'
  // 그 밖(시연 전용 초대, 로그인했지만 연결 없음, 만료) — 실패 안내
  | 'show_error';

export function inviteFailureAction(input: { reason?: string | null; signedIn: boolean; linked: boolean }): InviteFailureAction {
  if (input.reason === 'DEMO_ONLY') return 'show_error';
  if (!input.signedIn) return 'ask_login';
  // 만료(EXPIRED)는 수락된 적 없는 초대다 — 연결돼 있더라도 새 초대가 만료된 사실은 알려야 한다
  if (input.linked && input.reason !== 'EXPIRED') return 'open_home';
  return 'show_error';
}
