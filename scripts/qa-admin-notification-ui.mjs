// Isolated admin inbox / realtime UI. All RPC, auth, push, and navigation are mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const app = path.resolve('apps/admin-web');
const notices = [
  { id: '1', title: '긴 알림 제목에서도 근무 변경과 확인이 필요한 내용을 끝까지 읽을 수 있어야 해요', body: '출퇴근 기록을 확인해 주세요.', created_at: '2026-10-14T05:00:00Z', read_at: null, data: { url: 'https://outside.invalid' } },
  { id: '2', title: '근무지 대화로 이동', body: '새 메시지가 있어요.', created_at: '2026-10-14T05:00:00Z', read_at: null, data: { url: '/workroom' } },
];
const bundle = await build({
  stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import NotificationsPage from './app/notifications/page';
    import { AttendanceRealtime } from './app/timesheet/AttendanceRealtime';
    window.qa = { notices: ${JSON.stringify(notices)}, loadError: true, readError: true, events: [], refreshes: 0 };
    const root = createRoot(document.getElementById('root'));
    window.mount = mode => root.render(mode === 'realtime' ? <AttendanceRealtime facilityId="qa-facility" /> : <NotificationsPage />);
    window.mount('inbox');
  `, loader: 'tsx', resolveDir: app },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated-admin', setup(build) {
    const mocks = {
      '@/lib/supabase-browser': `export const supabase = {
        rpc: async name => name === 'get_my_notifications' ? { data: window.qa.notices, error: window.qa.loadError ? {} : null } : { data: !window.qa.readError, error: null },
        auth: { getUser: async () => { window.qa.events.push('auth'); return { data: { user: { id: 'qa' } } }; } },
        from: () => ({ upsert: () => { window.qa.events.push('save'); return new Promise(resolve => window.qa.save = resolve); } }),
        channel: () => ({ on(event, filter, callback) { window.qa.onLog = callback; return this; }, subscribe(callback) { callback('SUBSCRIBED'); return this; } }),
        removeChannel: async () => {}
      };`,
      '@/lib/push-subscribe': `export const isAdminPushEnabled = async () => { if (window.qa.stateError) throw new Error('state lookup'); return Boolean(window.qa.registered); };
        export const subscribeToAdminPush = () => { window.qa.events.push('permission'); return Promise.resolve({ endpoint: 'qa', toJSON: () => ({}) }); };`,
      'next/navigation': `const router = { refresh: () => window.qa.refreshes++ }; export const useRouter = () => router;`,
      '@/components/ui': `import React from 'react'; export const Card = ({ children, className }) => <section className={className}>{children}</section>;`,
    };
    build.onResolve({ filter: /^(?:@\/|next\/navigation$)/ }, args => {
      if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
    });
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: app }));
  } }],
});
const cssDir = path.join(app, '.next/static/css');
const css = (await Promise.all((await readdir(cssDir)).filter(file => file.endsWith('.css')).map(file => readFile(path.join(cssDir, file), 'utf8')))).join('\n').replace(/@import\s+[^;]+;/g, '');
const html = '<html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>';
const directory = await mkdtemp(path.join(tmpdir(), 'itdot-admin-notices-'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'https://qa.invalid' ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    await page.goto('https://qa.invalid/notifications');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    assert.equal(await page.evaluate(() => innerWidth), width);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('아직 알림이 없어요', { exact: true }).count(), 0);
    await page.evaluate(() => window.qa.loadError = false);
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    const first = page.getByRole('button').filter({ hasText: notices[0].title });
    await first.click();
    await page.getByRole('alert').filter({ hasText: '읽음 표시' }).waitFor();
    assert.ok((await first.getAttribute('class')).includes('bg-primary/5'));
    await page.evaluate(() => window.qa.readError = false);
    await first.click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('긴 알림 제목') && button.classList.contains('bg-white')));
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(page.url(), 'https://qa.invalid/notifications');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(directory, `${width}-inbox.png`), fullPage: true });
    await page.evaluate(() => { window.qa.registered = true; window.mount('realtime'); });
    assert.equal(await page.getByRole('button', { name: '알림 켜짐', exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.qa.events), []);
    await page.evaluate(() => window.mount('inbox'));
    await page.getByRole('heading', { name: '알림', exact: true }).waitFor();
    await page.evaluate(() => { window.qa.registered = false; window.qa.stateError = true; window.mount('realtime'); });
    await page.getByRole('status').filter({ hasText: '알림 등록 상태를 확인하지 못했어요' }).waitFor();
    const enable = page.getByRole('button', { name: '알림 켜기', exact: true });
    await enable.waitFor();
    await enable.evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => Boolean(window.qa.save));
    assert.deepEqual(await page.evaluate(() => window.qa.events), ['permission', 'auth', 'save']);
    assert.equal(await page.getByRole('button', { name: '설정 중...', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.qa.save({ error: new Error('검증용 알림 저장 실패') }));
    await page.getByRole('status').filter({ hasText: '검증용 알림 저장 실패' }).waitFor();
    await enable.click();
    await page.waitForFunction(() => window.qa.events.length === 6);
    await page.evaluate(() => window.qa.save({ error: null }));
    await page.getByRole('button', { name: '알림 켜짐', exact: true }).waitFor();
    await page.evaluate(() => window.qa.onLog({ new: { action: 'check_out', result: 'SUCCESS', staff_id: null, application_id: null } }));
    await page.getByRole('status').filter({ hasText: '퇴근 요청이 접수됐어요. 승인 상태를 확인해 주세요.' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(directory, `${width}-realtime.png`), fullPage: true });
    await page.evaluate(() => window.mount('inbox'));
    await page.getByRole('button').filter({ hasText: notices[1].title }).click();
    await page.waitForURL('https://qa.invalid/workroom');
    assert.deepEqual(errors, []);
    results.push({ width, checks: ['load error/retry', 'read failure/retry', 'unsafe URL blocked', 'internal destination', 'registered state shown', 'state lookup error recovery', 'permission before auth', 'single-flight setup', 'setup error/retry', 'checkout approval copy', 'no overflow or uncaught errors'] });
    await page.close();
  }
  console.log(JSON.stringify({ results, screenshots: directory, realBackendWrites: 0 }, null, 2));
} finally { await browser.close(); }
