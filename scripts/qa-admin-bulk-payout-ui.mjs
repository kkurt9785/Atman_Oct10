// Isolated React UI regression for the gig pay period + bulk payout panel (app/gig-pay/PayPeriodPanel.tsx).
// Server actions and next/link are replaced at bundle time. No login, backend connection, payment or production write.
// Usage: node scripts/qa-admin-bulk-payout-ui.mjs /absolute/path/to/playwright-core   (needs apps/admin-web/.next from `next build` for CSS)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const app = path.resolve('apps/admin-web');
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PayPeriodPanel } from './app/gig-pay/PayPeriodPanel';
    window.calls = [];
    const root = createRoot(document.getElementById('root'));
    const base = {
      today: '2026-11-05', until: '2026-11-05', keep: {}, showBulk: true,
      items: [
        { staffId: '00000000-0000-4000-8000-000000000001', name: '김하늘', amount: 82560 },
        { staffId: '00000000-0000-4000-8000-000000000002', name: '이바다', amount: 123840 },
        { staffId: '00000000-0000-4000-8000-000000000003', name: '박구름', amount: 41280 },
      ],
      excluded: [{ name: '최노을', reason: '지급 계좌 전달 대기' }],
      openNames: ['이바다'],
    };
    let version = 0;
    window.mount = (patch = {}, reset = true) => { if (reset) version++; root.render(<PayPeriodPanel key={version} {...base} {...patch} />); };
    window.mount();
  `, loader: 'tsx', resolveDir: app },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated', setup(build) {
    build.onResolve({ filter: /^\.\/actions$/ }, () => ({ path: 'mock-actions', namespace: 'qa' }));
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'mock-link', namespace: 'qa' }));
    build.onLoad({ filter: /^mock-actions$/, namespace: 'qa' }, () => ({ contents: `
      export const createGigPayoutsBulkAction = form => new Promise((resolve, reject) => window.calls.push({ data: Object.fromEntries(form), resolve, reject }));
    ` }));
    build.onLoad({ filter: /^mock-link$/, namespace: 'qa' }, () => ({ loader: 'tsx', resolveDir: app, contents: `
      export default function Link({ href, children, ...rest }) { return <a href={href} {...rest}>{children}</a>; }
    ` }));
    build.onResolve({ filter: /^@\// }, args => ({ path: path.join(app, args.path.slice(2) + '.ts') }));
  } }],
});
const cssDir = path.join(app, '.next/static/css');
const css = (await Promise.all((await readdir(cssDir)).filter(file => file.endsWith('.css')).map(file => readFile(path.join(cssDir, file), 'utf8')))).join('\n');
const directory = await mkdtemp(path.join(tmpdir(), 'itdot-bulk-payout-'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main style="padding:16px"><div id="root"></div></main></body></html>');
    await page.addStyleTag({ content: css.replace(/@import\s+[^;]+;/g, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const count = () => page.evaluate(() => window.calls.length);
    const last = () => page.evaluate(() => window.calls.at(-1).data);
    const settle = (value, error) => page.evaluate(([value, error]) => { const call = window.calls.at(-1); error ? call.reject(new Error(error)) : call.resolve(value); }, [value, error]);

    // Period chips: today is the default, other chips carry ?until=, the current one is marked.
    const chips = page.getByRole('navigation', { name: '정산 기간 끝' }).getByRole('link');
    assert.deepEqual(await chips.allInnerTexts(), ['오늘까지', '어제까지', '지난주까지']);
    assert.deepEqual(await chips.evaluateAll(links => links.map(a => a.getAttribute('href'))), ['/gig-pay', '/gig-pay?until=2026-11-04', '/gig-pay?until=2026-11-01']);
    assert.equal(await page.getByRole('link', { name: '오늘까지' }).getAttribute('aria-current'), 'page');
    await page.getByText('아직 퇴근 전인 근무가 있어요 · 이바다').waitFor();

    // Totals and the all-or-none 3.3% switch.
    await page.getByText('247,680원').first().waitFor(); // 82,560 + 123,840 + 41,280
    await page.getByRole('checkbox', { name: '3.3% 원천징수를 모두 적용' }).check();
    await page.getByText('−8,140원').waitFor(); // per person: 3% income tax + 10% local, each floored to 10원
    await page.getByText('239,540원').first().waitFor();
    await page.getByRole('checkbox', { name: '3.3% 원천징수를 모두 적용' }).uncheck();
    await page.getByText('이번에 빠지는 근무자 1명').click();
    await page.getByText('최노을 · 지급 계좌 전달 대기').waitFor();

    // Paid-now needs a second confirmation; backing out sends nothing.
    await page.getByRole('button', { name: /모두 이체 완료 기록/ }).click();
    await page.getByText('3명에게 실지급 247,680원을 모두 이체했나요?').waitFor();
    await page.getByRole('button', { name: '아직이에요' }).click();
    assert.equal(await count(), 0);
    await page.getByRole('button', { name: /모두 이체 완료 기록/ }).click();
    await page.getByRole('button', { name: '네, 모두 기록' }).evaluate(button => { button.click(); button.click(); });
    await page.getByText('3명 지급 기록을 저장 중이에요. 잠시만 기다려 주세요.').waitFor();
    assert.equal(await count(), 1, 'single flight');
    const sent = await last();
    assert.equal(sent.mode, 'now'); assert.equal(sent.until, '2026-11-05'); assert.equal(sent.withhold, '0');
    assert.deepEqual(JSON.parse(sent.items).map(i => i.expectedAmount), [82560, 123840, 41280]);
    assert.equal(await page.evaluate(() => document.querySelector('fieldset')?.disabled), true, 'inputs locked while saving');
    assert.equal(await page.getByRole('button', { name: '아직이에요' }).isDisabled(), true);
    await settle({ results: [
      { staffId: '00000000-0000-4000-8000-000000000001', ok: true, net: 82560 },
      { staffId: '00000000-0000-4000-8000-000000000002', ok: false, error: '근태 또는 급여가 바뀌었어요. 화면을 새로고침해 금액을 확인한 뒤 다시 기록해 주세요.' },
      { staffId: '00000000-0000-4000-8000-000000000003', ok: true, net: 41280 },
    ] });
    await page.getByRole('status').filter({ hasText: '2명 이체 완료로 기록했어요 · 실지급 123,840원' }).waitFor();
    await page.getByRole('alert').filter({ hasText: '이바다 · 근태 또는 급여가 바뀌었어요' }).waitFor();
    // After the server revalidates, the list shrinks but the outcome stays on screen.
    await page.evaluate(() => window.mount({ items: [], openNames: [] }, false));
    assert.equal(await page.getByRole('heading', { name: /한 번에 지급 기록/ }).count(), 0);
    await page.getByRole('status').filter({ hasText: '2명 이체 완료로 기록했어요' }).waitFor();

    // Scheduled for later: date chips, memo kept after a failure, the request carries the chosen date.
    await page.evaluate(() => window.mount());
    await page.getByRole('button', { name: '모두 나중에 지급' }).click();
    assert.equal(await page.getByLabel('지급 예정일').inputValue(), '2026-11-12');
    await page.getByRole('button', { name: '2주 뒤' }).click();
    await page.getByLabel('일괄 지급 메모 (선택)').fill('10월 마지막 주 정산');
    await page.getByRole('button', { name: '3명 지급 예정으로 기록' }).click();
    const later = await last();
    assert.equal(later.mode, 'later'); assert.equal(later.pay_at, '2026-11-19'); assert.equal(later.note, '10월 마지막 주 정산');
    await settle(null, '검증용 저장 오류');
    await page.getByRole('alert').filter({ hasText: '검증용 저장 오류' }).waitFor();
    assert.equal(await page.getByLabel('일괄 지급 메모 (선택)').inputValue(), '10월 마지막 주 정산');

    // A searched list never offers "pay everyone"; chips keep the search.
    await page.evaluate(() => window.mount({ showBulk: false, keep: { q: '김' } }));
    assert.equal(await page.getByRole('button', { name: /모두 이체 완료 기록/ }).count(), 0);
    assert.equal(await page.getByRole('link', { name: '어제까지' }).getAttribute('href'), '/gig-pay?q=%EA%B9%80&until=2026-11-04');

    // A hand-picked date shows as the current period with the "rest stays for next time" note.
    await page.evaluate(() => window.mount({ until: '2026-10-20' }));
    await page.getByText('10월 20일까지', { exact: true }).waitFor();
    await page.getByText('10월 20일까지 끝난 근무만 묶어요. 그 뒤 근무는 다음 지급에 그대로 남아요.').waitFor();
    assert.equal(await page.getByLabel('날짜 직접 고르기').inputValue(), '2026-10-20');

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(directory, `${width}-panel.png`), fullPage: true });
    results.push({ width, checks: ['period chips + current', 'open-work warning', 'totals + 3.3% switch', 'excluded reasons', 'confirm before paid', 'single flight + payload', 'partial failure per person', 'outcome survives revalidation', 'later date + memo kept on failure', 'no bulk when searched', 'custom date note', 'no overflow or uncaught errors'] });
    await page.close();
  }
  console.log(JSON.stringify({ results, screenshots: directory, realBackendWrites: 0 }, null, 2));
} finally { await browser.close(); }
