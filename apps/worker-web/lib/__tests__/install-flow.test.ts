import { describe, expect, it } from 'vitest';
import { detectBrowser, externalBrowserUrl } from '../in-app-browser';
import { installStepsFor } from '../install-steps';
import { installManifest, installStartUrl, inviteManifestHref, inviteMetadata } from '../install-manifest';
import { isClaimedInvite, rememberClaimedInvite } from '../invite-autoclaim';

// 카톡으로 받은 설치·초대 링크 → 바깥 브라우저 → 홈 화면에 추가까지의 규칙(2026-11-06).
const UA = {
  iosSafari18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  // iOS 26 사파리는 OS 버전을 18_6 으로 고정하고 Version/ 에 사파리 버전을 싣는다
  iosSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iosKakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.9.0',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  iosNaver: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.9.1)',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidKakao: 'Mozilla/5.0 (Linux; Android 15; SM-S928N Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36;KAKAOTALK 2511180',
  androidInstagram: 'Mozilla/5.0 (Linux; Android 15; SM-S928N Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0',
  desktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
};
const TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('브라우저 판정', () => {
  it('iOS 26 사파리는 사파리 버전으로 새 배치(⋯ → 공유)를 고른다', () => {
    const info = detectBrowser(UA.iosSafari26, 5);
    expect(info).toMatchObject({ ios: true, safari: true, safariMajor: 26, inApp: false });
    expect(installStepsFor(info)?.map((step) => step.icon)).toEqual(['more', 'share', 'add', 'done']);
  });
  it('iOS 18 사파리는 아래 가운데 공유부터 3단계', () => {
    const steps = installStepsFor(detectBrowser(UA.iosSafari18, 5));
    expect(steps?.map((step) => step.title)).toEqual(['아래 가운데 공유 누르기', "'홈 화면에 추가' 누르기", '오른쪽 위 추가 누르기']);
  });
  it('아이패드 데스크톱 UA 도 아이폰·아이패드로 본다', () => {
    expect(detectBrowser(UA.desktopSafari, 5)).toMatchObject({ ios: true, safari: true, safariMajor: 26 });
    expect(detectBrowser(UA.desktopSafari, 0)).toMatchObject({ ios: false, android: false, safari: false });
    expect(installStepsFor(detectBrowser(UA.desktopSafari, 0))).toBeNull();
  });
  it('아이폰 크롬은 주소창 공유 메뉴로 추가한다', () => {
    const info = detectBrowser(UA.iosChrome, 5);
    expect(info).toMatchObject({ chromeIos: true, safari: false });
    expect(installStepsFor(info)?.[0].title).toBe('주소창 오른쪽 공유 누르기');
  });
  it('안드로이드 크롬은 ⋮ → 앱 설치, 삼성 인터넷은 ≡ 메뉴', () => {
    expect(installStepsFor(detectBrowser(UA.androidChrome))?.map((step) => step.icon)).toEqual(['kebab', 'install', 'done']);
    expect(installStepsFor(detectBrowser(UA.androidSamsung))?.[0].icon).toBe('menu');
  });
  it('앱 안 브라우저는 설치 단계를 보여 주지 않는다', () => {
    for (const ua of [UA.iosKakao, UA.iosNaver, UA.androidKakao, UA.androidInstagram]) {
      expect(detectBrowser(ua, 5).inApp).toBe(true);
      expect(installStepsFor(detectBrowser(ua, 5))).toBeNull();
    }
  });
});

describe('바깥 브라우저로 열기', () => {
  it('카카오톡은 두 OS 모두 openExternal 스킴(주소 전체 인코딩)', () => {
    const url = `https://itdot.co.kr/gig/join?token=${TOKEN}`;
    const expected = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    expect(externalBrowserUrl(UA.iosKakao, url)).toBe(expected);
    expect(externalBrowserUrl(UA.androidKakao, url)).toBe(expected);
  });
  it('안드로이드의 다른 앱 안 브라우저는 크롬 intent, 아이폰은 방법 없음', () => {
    expect(externalBrowserUrl(UA.androidInstagram, 'https://itdot.co.kr/app?from=ig'))
      .toBe('intent://itdot.co.kr/app?from=ig#Intent;scheme=https;package=com.android.chrome;end');
    expect(externalBrowserUrl(UA.iosNaver, 'https://itdot.co.kr/app')).toBeNull();
  });
  it('일반 브라우저는 넘기지 않는다', () => {
    expect(externalBrowserUrl(UA.iosSafari26, 'https://itdot.co.kr/app')).toBeNull();
    expect(externalBrowserUrl(UA.androidChrome, 'https://itdot.co.kr/app')).toBeNull();
  });
});

describe('초대 화면 manifest — 홈 화면 앱이 그 초대에서 열린다', () => {
  it('초대 화면 주소만 시작 주소로 허용한다', () => {
    expect(installStartUrl(`/gig/join?token=${TOKEN}`)).toBe(`/gig/join?token=${TOKEN}`);
    expect(installStartUrl(`/workplace/join?token=${TOKEN}`)).toBe(`/workplace/join?token=${TOKEN}`);
    for (const bad of [null, '', '//evil.example/x', 'https://evil.example/', '/gig/join?token=abc', `/gig/join?token=${TOKEN}&next=/x`, `/settings?token=${TOKEN}`]) {
      expect(installStartUrl(bad)).toBe('/');
    }
  });
  it('앱 정체성(id·이름·아이콘)은 그대로, 시작 주소만 바뀐다', () => {
    const manifest = installManifest(`/gig/join?token=${TOKEN}`);
    expect(manifest).toMatchObject({ id: '/', scope: '/', short_name: '잇닿 근무자', display: 'standalone', start_url: `/gig/join?token=${TOKEN}` });
    expect(installManifest('//evil').start_url).toBe('/');
  });
  it('초대 화면은 그 초대용 manifest 와 카톡 미리보기를 단다', () => {
    expect(inviteManifestHref('gig', TOKEN)).toBe(`/api/install-manifest?start=${encodeURIComponent(`/gig/join?token=${TOKEN}`)}`);
    expect(inviteManifestHref('workplace', null)).toBe('/manifest.json');
    expect(inviteManifestHref('workplace', 'not-a-token')).toBe('/manifest.json');
    const metadata = inviteMetadata('workplace', TOKEN);
    expect(metadata.manifest).toContain('/api/install-manifest?start=');
    expect(metadata.openGraph?.title).toBe('근무 초대가 왔어요 · 잇닿');
  });
});

describe('수락한 초대 표시', () => {
  function memory() {
    const map = new Map<string, string>();
    return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  }
  it('수락한 초대만 기억하고 최근 10개까지 남긴다', () => {
    const storage = memory();
    rememberClaimedInvite('a', storage);
    expect(isClaimedInvite('a', storage)).toBe(true);
    expect(isClaimedInvite('b', storage)).toBe(false);
    for (let index = 0; index < 11; index += 1) rememberClaimedInvite(`t${index}`, storage);
    expect(isClaimedInvite('a', storage)).toBe(false);
    expect(isClaimedInvite('t10', storage)).toBe(true);
  });
  it('깨진 값이나 저장소가 없으면 수락 안 한 것으로 본다', () => {
    const storage = memory();
    storage.setItem('atman_claimed_invites', '{broken');
    expect(isClaimedInvite('a', storage)).toBe(false);
    expect(isClaimedInvite('a', null)).toBe(false);
  });
});
