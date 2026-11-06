// 스토어 스크린샷용 실제 화면 캡처 — itdot.co.kr 공개 시연(로그인 없이 여는 '써보기')을 읽기 전용으로 연다.
//
//   node docs/play-store/assets/src/capture-screens.mjs
//
// 결과: docs/play-store/assets/src/screens/*.png (1080×1920 = 360×640 화면 · DPR 3 · 모바일 UA)
// 그다음 render.mjs 가 캡션·프레임을 씌워 phone-1~6.png 를 만든다.
//
// ── 지키는 것 ─────────────────────────────────────────────────────────────
// · 누르는 것은 시작 화면의 직군 버튼 '간호사'와 초대 근무 '써보기'(공개 시연 입구), 공고 카드의 '지원하기'(확인 시트만 열림),
//   내 근무의 '달력' 보기 전환, 공고 정렬 선택뿐이다. 시트 안의 '지원하기'·출근하기·퇴근하기·초대 수락·대화·설정·초기화는 누르지 않는다.
// · 시연 로그인은 IP당 1분 10회 제한이 있다. 이 스크립트는 2회만 로그인한다(간호사 1 · 초대 근무 1).
// · 화면 아래 '지금은 시연 화면이에요' 띠는 실제 사용자에게 보이지 않는 시연 전용이라 캡처에서 숨긴다.
// · 시연 데이터의 사업장 이름은 실제 병원 이름이라(supabase/seed_demo_showcase.sql) 스토어 이미지에 그대로 쓰지 않는다.
//   응답에서 모은 사업장 이름·주소를 '○○병원'·'○○요양병원'·'경기도 수원시 팔달구 ○○로' 같은 자리표시로 바꾸고,
//   이름에 '데모'가 붙은 시연 근무자 이름은 '홍길동'으로, QA·테스트용 알림과 옛 문구('시프트') 알림 카드는 뺀다.
//   화면 구조·버튼·금액·시간은 실제 시연 화면 그대로다.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE ?? '/Users/kihankim/lumenix/main/node_modules/playwright-core';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = require(PLAYWRIGHT);

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screens');
mkdirSync(OUT, { recursive: true });
const SITE = 'https://itdot.co.kr';
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 응답 JSON 에서 사업장 이름·주소를 모은다(화면 글자를 바꿀 목록)
function collect(json, names, addresses) {
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.facility_name === 'string') names.add(value.facility_name);
    if (typeof value.facilityName === 'string') names.add(value.facilityName);
    if (typeof value.address_text === 'string') addresses.add(value.address_text);
    if (typeof value.name === 'string' && ('facility_type' in value || 'address_text' in value || 'business_registration_number' in value)) names.add(value.name);
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'facilities' || key === 'facility') && child) {
        for (const item of Array.isArray(child) ? child : [child]) if (item && typeof item.name === 'string') names.add(item.name);
      }
      walk(child);
    }
  };
  walk(json);
}

async function newSession(browser) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: UA, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light', reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const names = new Set();
  const addresses = new Set();
  const writes = [];
  page.on('response', async (response) => {
    if (!response.url().includes('.supabase.co/rest/v1/')) return;
    try { collect(await response.json(), names, addresses); } catch { /* JSON 아님 */ }
  });
  // 읽기 RPC(POST /rest/v1/rpc/get_*·list_*)와 시연 로그인 말고 다른 쓰기가 생기면 기록해 끝에 알린다
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' || url.includes('/auth/v1/')) return;
    if (/\/rest\/v1\/rpc\/(get_|list_)/.test(url) || url.endsWith('/api/demo-login')) return;
    writes.push(`${request.method()} ${url.replace(/\?.*$/, '')}`);
  });
  return { context, page, names, addresses, writes };
}

async function settle(page, ms = 2500) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(ms);
  await page.evaluate(() => document.fonts.ready);
}

// 시연 띠 숨김 + 사업장 이름·주소·시연 이름 자리표시
async function clean(page, session, { dropNotice } = {}) {
  await page.evaluate(({ names, addresses, dropNotice }) => {
    const style = document.getElementById('store-shot-style') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'store-shot-style' }));
    style.textContent = '[role="region"][aria-label="시연 안내"]{display:none!important}';
    const placeholder = (name) => {
      if (/팝업/.test(name)) return '○○ 팝업스토어';
      if (/요양병원/.test(name)) return '○○요양병원';
      if (/재활병원/.test(name)) return '○○재활병원';
      if (/약국/.test(name)) return '○○약국';
      if (/의원/.test(name)) return '○○의원';
      if (/병원/.test(name)) return '○○병원';
      return '○○ 사업장';
    };
    const regionOnly = (address) => {
      const parts = address.split(/\s+/);
      const keep = [];
      for (const part of parts) { keep.push(part); if (/(구|군)$/.test(part)) break; }
      if (keep.length === parts.length) keep.splice(Math.min(keep.length, 2));
      return `${keep.join(' ')} ○○로`;
    };
    const rules = [
      ...names.filter((n) => n && n.length > 1).sort((a, b) => b.length - a.length).map((n) => [n, placeholder(n)]),
      ...addresses.filter(Boolean).sort((a, b) => b.length - a.length).map((a) => [a, regionOnly(a)]),
      ['긱워커 데모', '홍길동'], [' (데모)', ''], ['(데모)', ''], ['시연 근무자', '홍길동'],
    ];
    if (dropNotice) {
      for (const card of document.querySelectorAll('main .space-y-2 > button')) {
        const title = card.querySelector('p')?.textContent ?? '';
        const text = card.textContent ?? '';
        const keep = /새 근무 공고|지원이 수락됐어요|30분 뒤 출근이에요/.test(title) && !/QA|테스트|시프트|데모/.test(text);
        if (!keep) card.remove();
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let text = node.nodeValue;
      for (const [from, to] of rules) if (text.includes(from)) text = text.split(from).join(to);
      if (text !== node.nodeValue) node.nodeValue = text;
    }
  }, { names: [...session.names], addresses: [...session.addresses], dropNotice: Boolean(dropNotice) });
  await sleep(300);
}

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  console.log('saved', path);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const report = [];
try {
  // ── 근무 찾기 시연(간호사) ──────────────────────────────────────────
  const medical = await newSession(browser);
  const { page } = medical;
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await settle(page, 1000);
  await shot(page, 'start');
  await page.getByRole('button', { name: '간호사', exact: true }).click();
  await page.waitForURL('**/home', { timeout: 30000 });
  await settle(page);

  await page.goto(`${SITE}/notifications`, { waitUntil: 'networkidle' });
  await settle(page);
  await clean(page, medical, { dropNotice: true });
  await shot(page, 'notifications');

  await page.goto(`${SITE}/shifts`, { waitUntil: 'networkidle' });
  await settle(page, 3000);
  // 기본 정렬(날짜·시간순) 그대로, '날짜별 근무' 제목이 화면 위쪽에 오게 내린다
  const listHeading = page.getByRole('heading', { name: '날짜별 근무' });
  await listHeading.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 14));
  await sleep(600);
  await clean(page, medical);
  await shot(page, 'shifts');

  // 첫 공고의 '지원하기' — 확인 시트만 연다(시트 안 버튼은 누르지 않는다)
  await page.locator('section[aria-label="근무 공고"] button', { hasText: '지원하기' }).first().click();
  const sheet = page.getByRole('dialog', { name: '근무 지원' });
  await sheet.waitFor();
  await settle(page, 2500);
  await clean(page, medical);
  await shot(page, 'apply-sheet');
  await page.keyboard.press('Escape');

  await page.goto(`${SITE}/applications`, { waitUntil: 'networkidle' });
  await settle(page, 3000);
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await sleep(800);
  await clean(page, medical);
  await shot(page, 'schedule');

  await page.goto(`${SITE}/earnings`, { waitUntil: 'networkidle' });
  await settle(page, 3000);
  // 첫 지급 기록의 '내 계좌 입금 확인' 버튼(누르지 않음)이 하단 탭 바로 위에 보이게 내린다
  const confirmButton = page.getByRole('button', { name: '내 계좌 입금 확인' }).first();
  if (await confirmButton.count()) {
    await confirmButton.evaluate((el) => {
      const bottom = el.getBoundingClientRect().bottom + window.scrollY;
      window.scrollTo(0, Math.max(0, bottom - (window.innerHeight - 64 - 20)));
    });
    await sleep(600);
  }
  await clean(page, medical);
  await shot(page, 'earnings');

  await page.goto(`${SITE}/home`, { waitUntil: 'networkidle' });
  await settle(page, 3000);
  await clean(page, medical);
  await shot(page, 'home');
  report.push(['근무 찾기 시연', medical.writes]);
  await medical.context.close();

  // ── 초대 근무 시연('써보기') — 이미 수락된 공용 시연이면 바로 '오늘' 화면, 아니면 초대 확인 화면(수락은 누르지 않는다)
  await sleep(4000);
  const gig = await newSession(browser);
  await gig.page.goto(SITE, { waitUntil: 'networkidle' });
  await settle(gig.page, 1000);
  await gig.page.getByRole('button', { name: /써보기/ }).click();
  await gig.page.waitForURL(/\/gig/, { timeout: 30000 });
  await settle(gig.page, 3500);
  await clean(gig.page, gig);
  await shot(gig.page, gig.page.url().includes('/gig/join') ? 'gig-invite' : 'gig-home');
  report.push(['초대 근무 시연', gig.writes]);
  await gig.context.close();
} finally {
  await browser.close();
}
for (const [label, writes] of report) console.log(`${label}: 읽기 외 요청 ${writes.length ? writes.join(', ') : '없음'}`);
