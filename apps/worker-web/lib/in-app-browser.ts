// 앱 안 브라우저(카카오톡 등) 판정과 바깥 브라우저로 열기.
// 앱 안 브라우저에서는 홈 화면 추가도 카카오 로그인도 안 된다 — 설치·초대 링크는 열리자마자 사파리·크롬으로 넘긴다.
//  · 카카오톡: kakaotalk://web/openExternal 스킴(카카오 공식 문서는 없지만 널리 쓰이고, 카카오 로그인에서 이미 쓴다)
//  · 그 밖의 앱 안 브라우저: 안드로이드는 크롬 intent 로 넘길 수 있고, 아이폰은 사용자가 직접 사파리에서 열어야 한다

export type BrowserInfo = {
  ios: boolean;
  android: boolean;
  kakao: boolean;
  inApp: boolean;
  /** 아이폰 사파리(앱 안 브라우저·다른 브라우저 제외) */
  safari: boolean;
  /** 아이폰 크롬 — iOS 16.4부터 공유 메뉴로 홈 화면에 추가할 수 있다 */
  chromeIos: boolean;
  /** 삼성 인터넷 — 갤럭시 기본 브라우저인 경우가 많다 */
  samsung: boolean;
  /** 사파리 버전(Version/26.0 → 26). iOS 26부터 UA 의 OS 버전이 18_6 으로 고정돼 화면 배치는 사파리 버전으로 고른다 */
  safariMajor: number | null;
};

export const IN_APP_BROWSER = /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|; wv\)/i;

export function detectBrowser(userAgent: string, maxTouchPoints = 0): BrowserInfo {
  const ios = /iphone|ipad|ipod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  const android = !ios && /android/i.test(userAgent);
  const kakao = /KAKAOTALK/i.test(userAgent);
  const inApp = IN_APP_BROWSER.test(userAgent);
  const chromeIos = ios && !inApp && /CriOS/i.test(userAgent);
  const otherIos = /FxiOS|EdgiOS|Whale|OPiOS|YaBrowser/i.test(userAgent);
  const safari = ios && !inApp && !chromeIos && !otherIos && /Safari\//.test(userAgent);
  const version = safari ? /Version\/(\d+)/.exec(userAgent) : null;
  return {
    ios, android, kakao, inApp, safari, chromeIos,
    samsung: /SamsungBrowser/i.test(userAgent),
    safariMajor: version ? Number(version[1]) : null,
  };
}

/** 홈 화면 앱(또는 Play 스토어 앱) 안에서 열려 있으면 true */
export function isStandaloneApp() {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

/** 이 주소를 바깥 브라우저로 여는 주소. 넘길 방법이 없으면 null(아이폰의 카카오톡 외 앱 안 브라우저 등) */
export function externalBrowserUrl(userAgent: string, url: string): string | null {
  if (/KAKAOTALK/i.test(userAgent)) return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  const info = detectBrowser(userAgent);
  if (info.android && info.inApp) {
    const target = new URL(url);
    return `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=https;package=com.android.chrome;end`;
  }
  return null;
}

/** 바깥 브라우저로 연다. 방법이 없으면 false — 화면에서 주소 복사로 안내한다 */
export function openInExternalBrowser(url = window.location.href) {
  const target = externalBrowserUrl(navigator.userAgent, url);
  if (!target) return false;
  window.location.href = target;
  return true;
}

const AUTO_OPENED_KEY = 'itdot_external_opened';

/**
 * 카카오톡 안이면 이 주소를 바깥 브라우저로 자동으로 한 번 넘긴다. 넘겼으면 true.
 * 카카오톡으로 돌아와 같은 화면이 다시 그려져도 반복하지 않게 이 탭에 표시를 남긴다 — 그때는 화면의 버튼으로 다시 연다.
 */
export function openKakaoExternallyOnce(url = window.location.href) {
  if (!/KAKAOTALK/i.test(navigator.userAgent)) return false;
  try {
    if (window.sessionStorage.getItem(AUTO_OPENED_KEY) === url) return false;
    window.sessionStorage.setItem(AUTO_OPENED_KEY, url);
  } catch { /* 표시를 못 남겨도 한 번은 넘긴다 */ }
  return openInExternalBrowser(url);
}
