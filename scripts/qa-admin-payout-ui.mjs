// Isolated React UI regression: server actions are replaced at bundle time.
// No login, backend connection, payment, or production write is performed.
// Usage: node scripts/qa-admin-payout-ui.mjs /absolute/path/to/playwright-core
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
    import { CreatePayoutForm, PayoutRowActions } from './app/gig-pay/PayoutForm';
    window.calls = [];
    const root = createRoot(document.getElementById('root'));
    let version = 0;
    window.mount = (row = false, disabled = false, reset = true) => {
      if (reset) version++;
      root.render(row ? <PayoutRowActions key={version} payoutId="qa-payout" /> : <CreatePayoutForm key={version} staffId="qa-staff" amount={123456} disabled={disabled} />);
    };
    window.mount();
  `, loader: 'tsx', resolveDir: app },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated-actions', setup(build) {
    build.onResolve({ filter: /^\.\/actions$/ }, () => ({ path: 'mock-actions', namespace: 'qa' }));
    build.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: `
      const run = (kind, form) => new Promise((resolve, reject) => window.calls.push({ kind, data: Object.fromEntries(form), resolve, reject }));
      export const createGigPayoutAction = form => run('create', form);
      export const markGigPayoutPaidAction = form => run('paid', form);
      export const cancelGigPayoutAction = form => run('cancel', form);
    ` }));
    build.onResolve({ filter: /^@\// }, args => ({ path: path.join(app, args.path.slice(2) + '.ts') }));
  } }],
});
const cssDir = path.join(app, '.next/static/css');
const css = (await Promise.all((await readdir(cssDir)).filter(file => file.endsWith('.css')).map(file => readFile(path.join(cssDir, file), 'utf8')))).join('\n');
const directory = await mkdtemp(path.join(tmpdir(), 'itdot-admin-ui-'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main style="padding:16px"><div id="root"></div></main></body></html>');
    assert.equal(await page.evaluate(() => innerWidth), width);
    // Omit remote font imports; this harness never needs network resources.
    await page.addStyleTag({ content: css.replace(/@import\s+[^;]+;/g, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const count = () => page.evaluate(() => window.calls.length);
    const complete = (error) => page.evaluate(error => {
      const call = window.calls.at(-1);
      error ? call.reject(new Error(error)) : call.resolve();
    }, error);
    const now = page.getByRole('button', { name: /이체 완료 기록/ });
    await now.waitFor();
    await now.evaluate(button => { button.click(); button.click(); });
    await page.getByText('지급 기록을 저장 중이에요. 잠시만 기다려 주세요.').waitFor();
    assert.equal(await count(), 1);
    assert.equal(await page.getByRole('checkbox').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '나중에 지급', exact: true }).isDisabled(), true);
    await complete();
    await page.getByRole('status').filter({ hasText: '지급 완료로 기록했어요' }).waitFor();
    assert.equal(await page.getByRole('checkbox').isEnabled(), true);
    await page.evaluate(() => window.mount());
    await page.getByRole('button', { name: '나중에 지급', exact: true }).click();
    await page.getByLabel('지급 메모 (선택)').fill('실패해도 보존할 메모');
    await page.getByRole('button', { name: '지급 예정으로 기록', exact: true }).click();
    assert.equal(await page.getByLabel('지급 예정일').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '취소', exact: true }).isDisabled(), true);
    await complete('검증용 저장 오류');
    await page.getByRole('alert').filter({ hasText: '검증용 저장 오류' }).waitFor();
    assert.equal(await page.getByLabel('지급 메모 (선택)').inputValue(), '실패해도 보존할 메모');
    await page.screenshot({ path: path.join(directory, `${width}-schedule-error.png`), fullPage: true });
    // A parent can disable the form while the schedule panel is already open.
    await page.evaluate(() => window.mount(false, true, false));
    await page.waitForFunction(() => document.querySelector('fieldset').disabled);
    const before = await count();
    await page.getByRole('button', { name: '지급 예정으로 기록', exact: true }).evaluate(button => button.click());
    assert.equal(await count(), before);
    await page.evaluate(() => window.mount(false, false, false));
    await page.getByRole('button', { name: '지급 예정으로 기록', exact: true }).click();
    await complete();
    await page.getByRole('status').filter({ hasText: '지급 예정' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.evaluate(() => window.mount(true));
    const paid = page.getByRole('button', { name: '이체 완료 기록', exact: true });
    await paid.waitFor();
    const rowBefore = await count();
    await paid.evaluate(button => { button.click(); button.parentElement.querySelectorAll('button')[1].click(); });
    await page.getByText('변경 사항을 저장 중이에요.').waitFor();
    assert.equal(await count(), rowBefore + 1);
    assert.equal(await page.getByRole('button', { name: '예정 취소', exact: true }).isDisabled(), true);
    await complete('검증용 변경 오류');
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: '예정 취소', exact: true }).click();
    await complete();
    await page.getByRole('status').filter({ hasText: '지급 예정을 취소했어요.' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(directory, `${width}-row-success.png`), fullPage: true });
    results.push({ width, checks: ['single-flight create', 'pending input lock', 'success unlock', 'failure preserves inputs', 'disabled schedule blocked', 'retry clears error', 'conflicting row actions blocked', 'row failure and retry', 'no overflow or uncaught errors'] });
    await page.close();
  }
  console.log(JSON.stringify({ results, screenshots: directory, realBackendWrites: 0 }, null, 2));
} finally { await browser.close(); }
