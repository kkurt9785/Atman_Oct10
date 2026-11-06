// 관리자 '시연 링크 보내기' → admin.itdot.co.kr/demo(영상 → 관리자 앱 설치) 흐름 점검(2026-11-06).
// 사용: (apps/admin-web 에서 next build && next start -p 31992) 뒤
//   node scripts/qa-admin-demo-link.mjs [플레이라이트 경로] [기준 주소=http://localhost:31992] [캡처 폴더]
// 운영 DB 에는 아무 요청도 보내지 않는다 — Supabase 요청은 전부 끊는다. 설치 창은 가짜 beforeinstallprompt 로만.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || '/Users/kihankim/lumenix/main/node_modules/playwright-core');
const BASE = process.argv[3] || 'http://localhost:31992';
const SHOTS = process.argv[4] || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const UA = {
  iosSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iosKakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.9.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidKakao: 'Mozilla/5.0 (Linux; Android 15; SM-S928N Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36;KAKAOTALK 2511180',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let passed = 0;
async function scenario(name, ua, path, run, { standalone = false, escaped = false, mobile = true, width = 375, height = 667 } = {}) {
  const context = await browser.newContext({ userAgent: ua, viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await context.newPage();
  const schemes = [], errors = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation', (event) => { if (/^(kakaotalk|intent):/.test(event.url)) schemes.push(event.url); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/supabase\.co\//, (route) => route.abort());
  await page.addInitScript(({ standalone, escaped, url }) => {
    if (standalone) { const original = window.matchMedia.bind(window); window.matchMedia = (query) => query.includes('display-mode: standalone') ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : original(query); }
    if (escaped) sessionStorage.setItem('itdot_external_opened', url);
    window.__copied = [];
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied.push(text); } }, configurable: true });
  }, { standalone, escaped, url: BASE + path });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await run(page, schemes);
  assert.equal(new URL(page.url()).pathname, path.split('?')[0], `${name}: 로그인으로 튕기지 않아야 함`);
  assert.deepEqual(errors, [], `${name}: 페이지 오류`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  await context.close();
  passed += 1;
  console.log(`PASS ${name}`);
}

const videoSrc = (page) => page.locator('video source').getAttribute('src');
const installHeading = (page) => page.getByRole('heading', { name: '관리자 앱 설치' });
async function aboveFold(page, locator, height) {
  const box = await locator.boundingBox();
  assert.ok(box && box.y + box.height <= height, `첫 화면 안에 보여야 함 (y=${box?.y})`);
}

await scenario('ios-kakao-auto-escape', UA.iosKakao, '/demo', async (page, schemes) => {
  assert.equal(schemes.length, 1, '카카오톡이면 바깥 브라우저로 한 번 넘긴다');
  assert.equal(schemes[0], 'kakaotalk://web/openExternal?url=' + encodeURIComponent(BASE + '/demo'));
  await page.getByText('사파리에서 이어서 설치해요').waitFor();
  assert.equal(await videoSrc(page), 'https://itdot.co.kr/demo/itdot-admin-demo.mp4');
  assert.equal(await page.locator('video').getAttribute('poster'), '/demo/admin-poster.jpg');
  assert.ok(await page.evaluate(async () => (await fetch('/demo/admin-poster.jpg')).ok), '대표 그림 파일');
});

await scenario('ios-kakao-return-no-repeat', UA.iosKakao, '/demo', async (page, schemes) => {
  assert.equal(schemes.length, 0, '카카오톡으로 돌아와도 자동 전환을 반복하지 않는다');
  await page.getByText('사파리에서 이어서 설치해요').waitFor();
  await page.getByRole('button', { name: '사파리로 열기' }).click();
  await page.waitForTimeout(300);
  assert.equal(schemes.length, 1, '버튼으로 다시 연다');
}, { escaped: true });

await scenario('ios-safari26', UA.iosSafari26, '/demo', async (page, schemes) => {
  assert.equal(schemes.length, 0);
  await page.getByRole('list', { name: '홈 화면에 추가하는 순서' }).getByText('주소창 오른쪽 ⋯ 누르기').waitFor();
  for (const step of ['공유 누르기', "'홈 화면에 추가' 누르기", '추가 누르기']) await page.getByRole('list', { name: '홈 화면에 추가하는 순서' }).getByText(step, { exact: true }).waitFor();
  assert.equal(await page.getByRole('img', { name: /⋯ 버튼|'공유' 줄|홈 화면에 추가' 줄/ }).count(), 3, '사파리 26 은 그림 3장(⋯ 버튼, 공유 줄, 홈 화면에 추가)');
  await page.getByText('⋯ 여기').waitFor();
  await aboveFold(page, page.locator('video'), 667);
  await aboveFold(page, installHeading(page), 667);
  await aboveFold(page, page.getByRole('list', { name: '홈 화면에 추가하는 순서' }).getByText('주소창 오른쪽 ⋯ 누르기'), 667);
  assert.equal(await page.getByRole('link', { name: '설치 없이 바로 눌러 보기 →' }).getAttribute('href'), '/login?demo=hospital');
});

await scenario('android-chrome-steps-then-one-tap', UA.androidChrome, '/demo', async (page) => {
  await page.getByText('버튼 세 번이면 설치돼요').waitFor();
  await page.getByRole('list', { name: '홈 화면에 추가하는 순서' }).getByText('오른쪽 위 ⋮ 누르기').waitFor();
  // 영상을 보는 사이 크롬이 설치 창을 허락하면 버튼 한 번으로 바뀐다
  await page.evaluate(() => { window.__prompts = 0; const event = new Event('beforeinstallprompt', { cancelable: true }); event.prompt = async () => { window.__prompts += 1; }; event.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(event); });
  const button = page.getByRole('button', { name: '관리자 앱 설치하기' });
  await button.waitFor();
  await aboveFold(page, button, 667 + 200);
  await button.click();
  await page.getByText('설치하고 있어요').waitFor();
  assert.equal(await page.evaluate(() => window.__prompts), 1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.getByText('✓ 설치했어요').waitFor();
});

await scenario('android-samsung-steps', UA.androidSamsung, '/demo', async (page) => {
  await page.getByRole('list', { name: '홈 화면에 추가하는 순서' }).getByText('아래 오른쪽 ≡ 메뉴 누르기').waitFor();
});

await scenario('android-kakao-auto-escape', UA.androidKakao, '/demo?kind=gigworker', async (page, schemes) => {
  assert.equal(schemes.length, 1);
  assert.equal(schemes[0], 'kakaotalk://web/openExternal?url=' + encodeURIComponent(BASE + '/demo?kind=gigworker'));
  await page.getByText('브라우저에서 이어서 설치해요').waitFor();
});

await scenario('gigworker-content', UA.iosSafari26, '/demo?kind=gigworker', async (page) => {
  await page.getByRole('heading', { name: '잇닿 단기·행사' }).waitFor();
  assert.equal(await videoSrc(page), 'https://itdot.co.kr/demo/itdot-gig-demo.mp4');
  await page.getByText('근무자 화면 참고 영상 · 약 1분 · 소리를 켜면 더 쉬워요').waitFor();
  assert.equal(await page.getByRole('link', { name: '설치 없이 바로 눌러 보기 →' }).getAttribute('href'), '/login?demo=gigworker');
  assert.equal(await page.getByRole('link', { name: '자세한 소개 보기' }).getAttribute('href'), 'https://itdot.co.kr/intro?role=admin&kind=gigworker');
});

await scenario('desktop-qr', UA.desktop, '/demo', async (page) => {
  await page.getByText('휴대폰으로 이어서 설치해요').waitFor();
  const inked = await page.locator('canvas').evaluate((canvas) => { const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0; for (let i = 0; i < data.length; i += 4) if (data[i] < 80) dark += 1; return dark; });
  assert.ok(inked > 500, 'QR 이 그려져야 함');
}, { mobile: false, width: 1280, height: 800 });

await scenario('installed-app', UA.iosSafari26, '/demo', async (page) => {
  await page.getByText('관리자 앱으로 보고 있어요').waitFor();
  assert.equal(await page.getByText('⋯ 여기').count(), 0);
}, { standalone: true });

// 보내는 쪽: 로그인 화면의 '시연 링크 보내기 · 앱 설치' → 새 링크
await scenario('login-share-card', UA.androidChrome, '/login', async (page) => {
  const summary = page.getByText('시연 링크 보내기 · 앱 설치 ›');
  if (await summary.count() === 0) { console.log('  (이 빌드는 시연 로그인이 꺼져 있어 공유 카드 점검 생략)'); return; }
  await summary.click();
  await page.getByRole('button', { name: '시연 링크 보내기' }).click();
  await page.getByRole('button', { name: '단기·행사 사장님용' }).click();
  await page.getByRole('button', { name: '시연 링크 보내기' }).click();
  assert.deepEqual(await page.evaluate(() => window.__copied), ['https://admin.itdot.co.kr/demo', 'https://admin.itdot.co.kr/demo?kind=gigworker']);
});

await browser.close();
console.log(`${passed}/10 통과`);
