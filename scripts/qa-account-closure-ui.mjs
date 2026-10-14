// Isolated browser regression: no auth, account deletion, or backend writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdtemp } from 'node:fs/promises';
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
    import { AccountClosureSection } from './app/settings/AccountClosureSection';
    window.calls = [];
    const root = createRoot(document.getElementById('root'));
    let version = 0;
    window.mount = (isDemo = false) => root.render(<AccountClosureSection key={++version} facilityName="검증 사업장" facilityWord="사업장" canClose ownsActive={false} isDemo={isDemo} />);
    window.mount();
  `, loader: 'tsx', resolveDir: app },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated-services', setup(build) {
    build.onResolve({ filter: /^@\/lib\/actions\/account$/ }, () => ({ path: 'actions', namespace: 'qa' }));
    build.onResolve({ filter: /^@\/lib\/supabase-browser$/ }, () => ({ path: 'auth', namespace: 'qa' }));
    build.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: args.path === 'auth'
      ? 'export const supabase = { auth: { signOut: async () => ({}) } };'
      : `const run = kind => new Promise((resolve, reject) => window.calls.push({kind, resolve, reject}));
         export const closeFacilityAction = () => run('close');
         export const withdrawAdminAccountAction = () => run('withdraw');` }));
  } }],
});
const cssDir = path.join(app, '.next/static/css');
const css = (await Promise.all((await readdir(cssDir)).filter(f => f.endsWith('.css')).map(f => readFile(path.join(cssDir, f), 'utf8')))).join('\n');
const directory = await mkdtemp(path.join(tmpdir(), 'itdot-closure-ui-'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css.replace(/@import\s+[^;]+;/g, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const close = page.getByRole('button', { name: '사업장 닫기', exact: true });
    await close.waitFor();
    assert.equal(await close.isDisabled(), true);
    await page.getByPlaceholder('검증 사업장').fill('검증 사업장');
    await page.getByRole('checkbox').check();
    await close.evaluate(b => { b.click(); b.click(); });
    assert.equal(await page.evaluate(() => window.calls.length), 1);
    assert.equal(await page.getByRole('button', { name: '처리 중...' }).count(), 2);
    await page.getByRole('button').last().evaluate(b => b.click());
    assert.equal(await page.evaluate(() => window.calls.length), 1);
    await page.evaluate(() => window.calls.at(-1).reject(new Error('연결 오류 · 다시 시도해 주세요')));
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByPlaceholder('검증 사업장').inputValue(), '검증 사업장');
    assert.equal(await close.isEnabled(), true);
    await page.getByRole('button', { name: '관리자 계정 탈퇴', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.at(-1).kind), 'withdraw');
    await page.evaluate(() => window.calls.at(-1).resolve({ ok: false, error: '계정 삭제가 완료되지 않았어요. 다시 시도해 주세요.' }));
    await page.getByRole('alert').filter({ hasText: '계정 삭제가 완료되지' }).waitFor();
    assert.equal(await page.getByRole('checkbox').isChecked(), true);
    assert.equal(await page.getByRole('button', { name: '관리자 계정 탈퇴', exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal((await close.boundingBox()).height >= 44, true);
    await page.screenshot({ path: path.join(directory, `${width}-retry.png`), fullPage: true });
    await page.evaluate(() => window.mount(true));
    await page.getByText('시연 사업장은 닫을 수 없어요.').waitFor();
    assert.equal(await page.getByRole('button').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: closure/withdrawal single flight, failure recovery, preserved inputs, demo guard, layout`);
    await page.close();
  }
  console.log(`Screenshots: ${directory}`);
} finally { await browser.close(); }
