// 카카오 로그인 시작. 카카오 인앱 브라우저는 OAuth 리다이렉트를 막으므로 외부 브라우저로 먼저 나간다.
export const KAKAO_OAUTH_STATE_KEY = 'itdot_worker_kakao_oauth_state';

export function startKakaoLogin() {
  if (navigator.userAgent.includes('KAKAO')) {
    window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(window.location.href);
    return;
  }
  const key = process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY;
  const state = crypto.randomUUID();
  window.sessionStorage.setItem(KAKAO_OAUTH_STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: key ?? '',
    redirect_uri: `${window.location.origin}/auth/callback`,
    response_type: 'code',
    scope: 'openid profile_nickname profile_image',
    state,
  });
  window.location.href = `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
}

export function KakaoGlyph() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M10 2C5.582 2 2 4.895 2 8.455c0 2.27 1.512 4.263 3.786 5.39l-.964 3.5a.25.25 0 00.38.273L9.58 15.1A9.18 9.18 0 0010 15.11c4.418 0 8-2.895 8-6.455S14.418 2 10 2z" fill="#191F28" />
    </svg>
  );
}
