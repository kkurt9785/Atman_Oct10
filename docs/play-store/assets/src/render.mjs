// 스토어 그래픽 렌더 — 이 폴더의 HTML 을 Chrome 으로 찍어 docs/play-store/assets/ 에 PNG 로 저장하고 규격을 확인한다.
//
//   node docs/play-store/assets/src/render.mjs            # 전부
//   node docs/play-store/assets/src/render.mjs phone-3    # 이름에 'phone-3' 이 들어간 것만
//
// 실제 화면 캡처(screens/*.png)는 capture-screens.mjs 로 먼저 만든다.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE ?? '/Users/kihankim/lumenix/main/node_modules/playwright-core';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = require(PLAYWRIGHT);

const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = dirname(SRC);
const REPO = join(OUT, '..', '..', '..');
const only = process.argv[2];

// 스크린샷 순서·캡션 — 캡션은 한 줄, 해요체·짧은 명사구(사용자 시작 화면 문구와 같은 결)
export const PHONES = [
  { name: 'phone-1', shot: 'screens/notifications.png', caption: '가만히 있어도 새 근무 알림' },
  { name: 'phone-2', shot: 'screens/shifts.png', caption: '내 지역 근무를 한눈에' },
  { name: 'phone-3', shot: 'screens/apply-sheet.png', caption: '지원 전에 예상 금액부터' },
  { name: 'phone-4', shot: 'screens/schedule.png', caption: '근무표 보고 바로 출퇴근' },
  { name: 'phone-5', shot: 'screens/earnings.png', caption: '일한 금액, 지급까지 확인' },
  { name: 'phone-6', shot: 'screens/gig-home.png', caption: '단기·행사 근무도 한 앱에서' },
];

const JOBS = [
  ...PHONES.map((p) => ({ name: p.name, file: 'phone.html', query: { shot: p.shot, caption: p.caption }, width: 1080, height: 1920 })),
  { name: 'feature-graphic', file: 'feature-graphic.html', width: 1024, height: 500 },
  { name: 'og-install', file: 'og-install.html', width: 1200, height: 630 },
  { name: 'og-invite', file: 'og-invite.html', width: 1200, height: 630 },
];

function inspect(path) {
  const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', path], { encoding: 'utf8' });
  const get = (key) => info.match(new RegExp(`${key}: (\\S+)`))?.[1];
  const kind = execFileSync('file', ['-b', path], { encoding: 'utf8' }).trim();
  return { width: Number(get('pixelWidth')), height: Number(get('pixelHeight')), alpha: get('hasAlpha') === 'yes', kind, bytes: statSync(path).size };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
try {
  for (const job of JOBS) {
    if (only && !job.name.includes(only)) continue;
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
    const url = pathToFileURL(join(SRC, job.file));
    if (job.query) url.search = new URLSearchParams(job.query).toString();
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((ok) => { img.onload = ok; img.onerror = ok; })));
    });
    const fontOk = await page.evaluate(() => document.fonts.check('800 40px "Pretendard Variable"'));
    // 글자가 정해진 칸을 넘으면 렌더를 멈춘다(잘림 방지)
    const overflow = await page.evaluate(() => [...document.querySelectorAll('[data-fit]')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 || el.getBoundingClientRect().right > document.documentElement.clientWidth)
      .map((el) => el.textContent));
    const path = join(OUT, `${job.name}.png`);
    await page.screenshot({ path, clip: { x: 0, y: 0, width: job.width, height: job.height } });
    await page.close();
    results.push({ name: `${job.name}.png`, expect: [job.width, job.height], fontOk, overflow, ...inspect(path) });
  }
  if (!only || 'icon-512'.includes(only)) {
    // Play 아이콘: 앱의 전체 칸(마스크 전) 아이콘을 32비트 PNG 로. 모서리는 Play 가 둥글게 깎는다.
    const src = join(REPO, 'apps/worker-web/public/icon-512-maskable.png');
    const path = join(OUT, 'icon-512.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-pix_fmt', 'rgba', path]);
    results.push({ name: 'icon-512.png', expect: [512, 512], fontOk: true, overflow: [], ...inspect(path) });
  }
} finally {
  await browser.close();
}

let failed = false;
for (const r of results) {
  const sizeOk = r.width === r.expect[0] && r.height === r.expect[1];
  const alphaOk = r.name === 'icon-512.png' ? true : !r.alpha;
  const ok = sizeOk && alphaOk && r.fontOk && r.overflow.length === 0 && r.bytes <= 8 * 1024 * 1024;
  if (!ok) failed = true;
  console.log(`${ok ? 'OK ' : 'NG '} ${r.name.padEnd(20)} ${r.width}×${r.height}  alpha=${r.alpha ? 'yes' : 'no'}  ${(r.bytes / 1024).toFixed(0)}KB  font=${r.fontOk ? 'Pretendard' : 'FALLBACK'}${r.overflow.length ? `  OVERFLOW: ${r.overflow.join(' | ')}` : ''}  (${r.kind})`);
}
if (failed) process.exitCode = 1;
