// Live, read-only check of the /gig-pay period panel on the public gig demo. Never presses a record button.
// Usage: node scripts/qa-live-gig-pay-period.mjs /absolute/path/to/playwright-core
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url), { chromium } = require(process.argv[2] || 'playwright-core');
const directory = await mkdtemp(path.join(tmpdir(), 'itdot-live-gig-pay-'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const amount = text => Number((text.match(/[\d,]+/) ?? ['0'])[0].replace(/,/g, ''));
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://admin.itdot.co.kr/login?demo=gigworker');
  await page.waitForURL(url => url.pathname === '/', { timeout: 60000 });
  await page.goto('https://admin.itdot.co.kr/gig-pay');
  await page.getByRole('heading', { name: '지급 관리', exact: true }).waitFor();
  await page.getByRole('heading', { name: '정산 기간', exact: true }).waitFor();
  const chips = page.getByRole('navigation', { name: '정산 기간 끝' }).getByRole('link');
  const labels = await chips.allInnerTexts();
  assert.ok(labels[0] === '오늘까지' && labels.includes('어제까지'), `chips: ${labels}`);
  assert.equal(await page.getByRole('link', { name: '오늘까지' }).getAttribute('aria-current'), 'page');
  const tile = page.getByText('지급할 금액').locator('xpath=..');
  const todayTotal = amount(await tile.innerText());
  const bulk = await page.getByRole('heading', { name: /한 번에 지급 기록/ }).count();
  await page.screenshot({ path: path.join(directory, 'today.png'), fullPage: true });

  const lastWeek = page.getByRole('link', { name: labels.includes('지난주까지') ? '지난주까지' : '어제까지' });
  const target = await lastWeek.getAttribute('href');
  await lastWeek.click();
  await page.waitForURL(url => url.search.includes('until='));
  const until = new URL(page.url()).searchParams.get('until');
  assert.ok(target.endsWith(`until=${until}`));
  await page.getByText(/까지 끝난 근무만 묶어요\. 그 뒤 근무는 다음 지급에 그대로 남아요\./).waitFor();
  const pastTotal = amount(await page.getByText('지급할 금액').locator('xpath=..').innerText());
  assert.ok(pastTotal <= todayTotal, `earlier end date cannot owe more (${pastTotal} > ${todayTotal})`);
  assert.equal(await page.getByLabel('날짜 직접 고르기').inputValue(), until);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(directory, 'past.png'), fullPage: true });
  console.log(JSON.stringify({ result: 'PASS', chips: labels, todayTotal, until, pastTotal, bulkPanelShown: bulk > 0, screenshots: directory, writes: 0 }, null, 2));
} finally { await browser.close(); }
