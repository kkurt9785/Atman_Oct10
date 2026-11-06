// 카톡으로 받은 설치·초대 링크 → 바깥 브라우저 → 홈 화면에 추가 흐름 점검(2026-11-06).
// 사용: (apps/worker-web 에서 next build && next start -p 31990) 뒤
//   node scripts/qa-install-flow.mjs [플레이라이트 경로] [기준 주소=http://localhost:31990] [캡처 폴더]
// 운영 DB 에는 아무 요청도 보내지 않는다 — Supabase 요청은 초대 미리보기만 가짜 응답으로 채우고 나머지는 끊는다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || '/Users/kihankim/lumenix/main/node_modules/playwright-core');
const BASE = process.argv[3] || 'http://localhost:31990';
const SHOTS = process.argv[4] || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const UA = {
  iosSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iosSafari18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iosKakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.9.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidKakao: 'Mozilla/5.0 (Linux; Android 15; SM-S928N Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36;KAKAOTALK 2511180',
};
const TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PREVIEW = { ok: true, isGigworker: true, facilityName: '성수 팝업 현장', facilityAddress: '서울 성동구', workerName: '김근무', contractStart: '2026-11-08', contractEnd: '2026-11-09', workWeekdays: [6, 7], startTime: '10:00:00', endTime: '19:00:00', payBasis: 'hourly', payRate: 12000 };

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let passed = 0;
async function scenario(name, ua, run, { standalone = false, claimed = false, escaped = null, height = 667 } = {}) {
  const context = await browser.newContext({ userAgent: ua, viewport: { width: 375, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await context.newPage();
  const schemes = [], errors = [];
  // 바깥 브라우저로 넘기는 kakaotalk:// · intent:// 이동은 요청이 아니라서 CDP 의 이동 요청 이벤트로 잡는다
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation', (event) => { if (/^(kakaotalk|intent):/.test(event.url)) schemes.push(event.url); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/supabase\.co\//, (route) => route.request().url().includes('/rpc/get_facility_staff_invite_preview')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(PREVIEW) })
    : route.abort());
  await page.addInitScript(({ standalone, claimed, escaped, token }) => {
    if (standalone) { const original = window.matchMedia.bind(window); window.matchMedia = (query) => query.includes('display-mode: standalone') ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : original(query); }
    if (claimed) localStorage.setItem('atman_claimed_invites', JSON.stringify([token]));
    // 이미 한 번 바깥으로 넘긴 뒤 카카오톡으로 돌아온 탭
    if (escaped) sessionStorage.setItem('itdot_external_opened', escaped);
    window.__prompts = 0;
  }, { standalone, claimed, escaped, token: TOKEN });
  try {
    await run(page, schemes);
    assert.deepEqual(errors, [], `${name}: 화면 오류`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
    passed += 1;
    console.log(`PASS ${name}`);
  } finally { await context.close(); }
}

// 1. 설치 링크 — 카카오톡(아이폰·안드로이드)은 열리자마자 바깥 브라우저로
for (const [name, ua, heading] of [['app-kakao-ios', UA.iosKakao, '사파리에서 이어서 설치해요'], ['app-kakao-android', UA.androidKakao, '브라우저에서 이어서 설치해요']]) {
  await scenario(name, ua, async (page, schemes) => {
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: heading }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(schemes.length, 1, '열리자마자 한 번 넘긴다');
    assert.ok(schemes[0].includes(`kakaotalk://web/openExternal?url=${encodeURIComponent(`${BASE}/app`)}`), schemes[0]);
  });
  // 헤드리스 크롬은 처리 못 한 첫 이동이 걸려 있으면 같은 주소 이동을 무시한다 — 돌아온 탭은 따로 띄워 확인한다
  await scenario(`${name}-returned`, ua, async (page, schemes) => {
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: heading }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(schemes.length, 0, '카카오톡으로 돌아와 다시 그려지면 또 넘기지 않는다');
    await page.getByRole('button', { name: /사파리로 열기|브라우저로 열기/ }).click(); await page.waitForTimeout(300);
    assert.equal(schemes.length, 1, '버튼으로 다시 연다');
  }, { escaped: `${BASE}/app` });
}

// 2. 설치 링크 — 아이폰 사파리: 26 은 ⋯ → 공유 → 홈 화면에 추가 → 추가, 18 은 공유부터 3단계. 첫 화면 안에 다 보여야 한다
for (const [name, ua, count, pointer] of [['app-ios-safari26', UA.iosSafari26, 4, '⋯ 여기'], ['app-ios-safari18', UA.iosSafari18, 3, '공유 여기']]) {
  await scenario(name, ua, async (page) => {
    await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
    const steps = page.getByRole('list', { name: '홈 화면에 추가하는 순서' });
    await steps.waitFor();
    assert.equal(await steps.getByRole('listitem').count(), count);
    const box = await steps.getByRole('listitem').last().boundingBox();
    assert.ok(box && box.y + box.height <= 667 - 60, `마지막 단계가 첫 화면 안(사파리 막대 위)에 있어야 함: ${JSON.stringify(box)}`);
    await page.getByText(pointer, { exact: true }).waitFor();
    await page.getByText('카카오로 한 번 로그인하면 끝이에요', { exact: false }).waitFor();
  });
}

// 3. 설치 링크 — 안드로이드 크롬: 설치 창 허락 전엔 메뉴 3단계, 허락되면 버튼 한 번
await scenario('app-android-chrome', UA.androidChrome, async (page) => {
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '버튼 세 번이면 설치돼요' }).waitFor();
  assert.equal(await page.getByRole('list', { name: '홈 화면에 추가하는 순서' }).getByRole('listitem').count(), 3);
  await page.evaluate(() => { const event = new Event('beforeinstallprompt'); event.prompt = async () => { window.__prompts += 1; }; event.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(event); });
  await page.getByRole('heading', { name: '버튼 한 번이면 설치돼요' }).waitFor();
  await page.getByRole('button', { name: '잇닿 설치하기' }).click();
  await page.getByText('설치하고 있어요').waitFor();
  assert.equal(await page.evaluate(() => window.__prompts), 1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.getByText('✓ 설치했어요').waitFor();
});

// 4. 이미 설치한 앱 안에서 설치 링크를 열면 시작 화면으로
await scenario('app-standalone', UA.iosSafari26, async (page) => {
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${BASE}/`);
}, { standalone: true });

// 5. 초대 링크 — 아이폰 사파리(로그인 전): '앱 추가하고 수락하기 · 방법 보기'가 먼저, 이 초대를 시작 주소로 하는 manifest
await scenario('invite-ios-safari', UA.iosSafari26, async (page) => {
  await page.goto(`${BASE}/gig/join?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '앱 추가하고 수락하기 · 방법 보기' }).waitFor();
  await page.getByRole('button', { name: '설치 없이 지금 수락하기' }).waitFor();
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(`${BASE}${href}`)).json();
  assert.equal(manifest.start_url, `/gig/join?token=${TOKEN}`);
  assert.equal(manifest.id, '/');
  await page.getByRole('button', { name: '앱 추가하고 수락하기 · 방법 보기' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('이 초대가 바로 열려요', { exact: false }).waitFor();
  assert.equal(await dialog.getByRole('listitem').count(), 4);
}, { height: 844 });

// 6. 초대 링크 — 안드로이드 크롬은 지금처럼 바로 수락(설치는 수락 뒤 한 번)
await scenario('invite-android-chrome', UA.androidChrome, async (page) => {
  await page.goto(`${BASE}/gig/join?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '카카오로 가입하고 초대 수락' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '앱 추가하고 수락하기 · 방법 보기' }).count(), 0);
}, { height: 844 });

// 7. 초대 링크 — 카카오톡: 열리자마자 바깥 브라우저로, 안 열렸을 때 다시 여는 버튼
await scenario('invite-kakao-ios', UA.iosKakao, async (page, schemes) => {
  await page.goto(`${BASE}/gig/join?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  // 카카오톡 안에서는 큰 버튼이 '사파리로 열고 수락하기'(안드로이드는 크롬) — 노란 안내 상자·밑줄 링크는 없앴다
  await page.getByRole('button', { name: '사파리로 열고 수락하기' }).waitFor();
  assert.equal(await page.getByText('사파리·크롬으로 열기').count(), 0);
  assert.equal(schemes.length, 1);
  assert.ok(schemes[0].includes(encodeURIComponent(`${BASE}/gig/join?token=${TOKEN}`)), schemes[0]);
}, { height: 844 });

// 8. 이 기기에서 이미 수락한 초대(초대에서 시작하는 홈 화면 앱) → 바로 내 근무로
await scenario('invite-claimed', UA.iosSafari26, async (page) => {
  await page.goto(`${BASE}/gig/join?token=${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => url.pathname === '/gig');
}, { standalone: true, claimed: true });

// 9. 미리보기 — 설치 링크는 '잇닿 근무자 앱', 초대는 '근무 초대가 왔어요'
for (const [path, title, image] of [['/app', '잇닿 근무자 앱', '/og/install.png'], [`/workplace/join?token=${TOKEN}`, '근무 초대가 왔어요 · 잇닿', '/og/invite.png']]) {
  const html = await (await fetch(`${BASE}${path}`)).text();
  assert.ok(html.includes(`<meta property="og:title" content="${title}"/>`), `${path} og:title`);
  assert.ok(html.includes(`https://itdot.co.kr${image}`), `${path} og:image`);
  passed += 1;
  console.log(`PASS og ${path}`);
}

await browser.close();
console.log(`ALL PASS ${passed}`);
