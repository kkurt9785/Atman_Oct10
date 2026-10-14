// Render real components with fixture data; block all network and server actions.
// node scripts/qa-uiux-review.mjs /absolute/path/to/playwright-core
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const output = await mkdtemp(path.join(tmpdir(), 'itdot-uiux-'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const statement = { facilityName: '검증 사업장', workerName: '김하늘', periodStart: '2026-10-01', periodEnd: '2026-10-14', workedDays: 10, workedMinutes: 4800, payBasis: 'hourly', payRate: 12000, amount: 960000, withholdingAmount: 31680, netAmount: 928320, status: 'scheduled', payAt: '2026-10-16', paidAt: null };
const workers = ['late', 'working', 'invite'].map((status, i) => ({ staffId: `staff-${i}`, assignmentId: `assignment-${i}`, name: ['김하늘', '이서준', '박지우'][i], title: '가을 행사 안내 및 현장 지원', workerLinked: status !== 'invite', invitePending: status === 'invite', startTime: '09:00', endTime: '18:00', status, statusLabel: ['출근 확인 필요', '근무 중', '초대 대기'][i], checkInAt: null, checkOutAt: null, bankShared: false, unpaidDays: 0, unreadMessages: i === 0 ? 2 : 0, nextDate: null }));
const board = { today: '2026-10-14', workers, summary: { invite: 1, working: 1, issue: 1, pay: 0 }, days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${14 + i}`, dateLabel: `10/${14 + i}`, dayLabel: ['수', '목', '금', '토', '일', '월', '화'][i], workers: i === 0 ? workers : [] })) };
const project = { id: 'project-qa', title: '가을 행사 현장 안내', headcount: 5, payRate: 12000, startTime: '09:00', endTime: '18:00', participants: workers.map(w => ({ ...w, todayStatus: w.status })) };
const results = [];
try {
  for (const kind of ['admin', 'worker']) {
    const app = path.resolve(`apps/${kind}-web`);
    const imports = kind === 'admin' ? `
      import { GigOperationsBoard } from './components/GigOperationsBoard';
      import { BottomNav } from './components/BottomNav';
      import { SegmentTabs } from './components/SegmentTabs';
      import { PayoutDetail } from './app/gig-pay/PayoutDetail';
      import { PayoutRowActions } from './app/gig-pay/PayoutForm';
    ` : `
      import { GigNav } from './components/gig/GigNav';
      import { WorkerNav } from './components/WorkerNav';
      import { PayoutDetail } from './components/gig/PayoutDetail';
    `;
    const contents = `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      ${imports}
      const root = createRoot(document.getElementById('root'));
      window.mount = (medical = false) => {
        window.qaPath = medical ? '${kind === 'admin' ? '/timesheet' : '/applications'}' : '${kind === 'admin' ? '/' : '/gig/settlement'}';
        root.render(<main className="mx-auto p-4 pb-28 ${kind === 'admin' ? 'max-w-5xl' : 'max-w-app'}">
          ${kind === 'admin' ? `<GigOperationsBoard board={${JSON.stringify(board)}} projects={[${JSON.stringify(project)}]} facilityId="qa" facilityName="잇닿 가을 행사팀" />
          <SegmentTabs tabs={[{ key: 'all', label: '전체 지급' }, { key: 'pending', label: '지급 예정' }, { key: 'paid', label: '지급 완료' }]} active="all" basePath="/gig-pay" />` : '<h1 className="text-xl font-bold">근태·지급</h1>'}
          <section aria-label="지급 내역" className="mt-4 rounded-2xl bg-white p-4"><PayoutDetail statement={${JSON.stringify(statement)}} right={${kind === 'admin' ? '<PayoutRowActions payoutId="qa" />' : '<span className="rounded-full bg-primary/10 p-2 text-xs text-primary">지급 예정</span>'}} /></section>
          ${kind === 'admin' ? '<BottomNav mode={medical ? "medical" : "gig"} />' : '{medical ? <WorkerNav /> : <GigNav /> }'}
        </main>);
      }; window.mount();
    `;
    const mocks = {
      'next/link': `import React from 'react'; export default function Link({href,children,scroll,prefetch,...props}) { return <a href={href} {...props}>{children}</a>; }`,
      'next/navigation': `export const usePathname = () => window.qaPath; export const useRouter = () => ({ refresh() {} });`,
      '@/lib/supabase-browser': `export const supabase = { rpc() { throw Error('Backend forbidden in UI test'); } };`,
      '@/lib/db/gig-projects': `export const projectRunsOn = (_, date) => date === '2026-10-14'; export const projectScheduleText = () => '10월 14일 · 09:00~18:00';`,
      './actions': `export const createGigPayoutAction = () => { throw Error('Payment forbidden'); }; export const markGigPayoutPaidAction = createGigPayoutAction; export const cancelGigPayoutAction = createGigPayoutAction;`,
    };
    const bundle = await build({ stdin: { contents, loader: 'tsx', resolveDir: app }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-ui', setup(b) {
      b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'qa' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: app }));
      b.onResolve({ filter: /^@\// }, args => ({ path: path.join(app, args.path.slice(2) + '.ts') }));
    } }] });
    const cssDir = path.join(app, '.next/static/css');
    const css = (await Promise.all((await readdir(cssDir)).filter(f => f.endsWith('.css')).map(f => readFile(path.join(cssDir, f), 'utf8')))).join('\n').replace(/@import\s+[^;]+;/g, '');
    for (const [width, big] of kind === 'admin' ? [[360, false], [390, false], [1440, false], [360, true]] : [[360, false], [390, false]]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 500, hasTouch: width < 500 });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent(`<html lang="ko" class="${big ? 'big-text' : ''}"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>`);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByRole('navigation').last().waitFor();
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${kind} ${width} big=${big}: overflow`);
      await noOverflow();
      const nav = page.getByRole('navigation').last();
      assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
      for (const link of await nav.getByRole('link').all()) {
        const rect = await link.boundingBox();
        assert.ok(rect.height >= 44 && rect.width >= 44);
      }
      await page.screenshot({ path: path.join(output, `${kind}-${width}${big ? '-big' : ''}-home.png`), fullPage: true });
      if (kind === 'admin') {
        const issue = page.getByRole('button', { name: /확인 필요/ });
        await issue.click(); assert.equal(await issue.getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('#operation-workers article').count(), 1);
        await page.getByRole('button', { name: /지급 준비/ }).click();
        await page.getByRole('button', { name: '전체 근무자 보기' }).click();
        assert.equal(await page.locator('#operation-workers article').count(), 3);
        const select = page.getByRole('button', { name: '김하늘 선택', exact: true });
        const bounds = await select.boundingBox(); assert.ok(bounds.height >= 44 && bounds.width >= 44);
        await select.click(); assert.equal(await select.getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: '근무자 선택 해제' }).click();
        assert.equal(await select.getAttribute('aria-pressed'), 'false');
        const tomorrow = page.getByRole('button', { name: '2026-10-15 목', exact: true });
        assert.equal(await tomorrow.evaluate(button => getComputedStyle(button).whiteSpace), 'nowrap');
        await tomorrow.click(); assert.equal(await tomorrow.getAttribute('aria-pressed'), 'true');
        await page.getByText('등록된 근무가 없어요.', { exact: true }).waitFor();
      }
      const disclosure = page.getByRole('button', { name: /928,320원.*명세 (보기|접기)/ });
      await disclosure.click();
      assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
      const id = await disclosure.getAttribute('aria-controls');
      assert.equal(await page.evaluate(id => !!document.getElementById(id), id), true);
      await page.getByText('실지급', { exact: true }).waitFor();
      await noOverflow();
      await page.screenshot({ path: path.join(output, `${kind}-${width}${big ? '-big' : ''}-detail.png`), fullPage: true });
      await disclosure.click(); assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
      await page.evaluate(() => window.mount(true));
      await page.waitForFunction(() => document.querySelector('nav:last-child')?.querySelectorAll('a').length === 5);
      assert.equal(await page.getByRole('navigation').last().locator('[aria-current="page"]').count(), 1);
      await noOverflow();
      const current = page.getByRole('navigation').last().locator('[aria-current="page"]');
      await current.focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
      assert.deepEqual(errors, []);
      results.push({ kind, width, big, status: 'passed' });
      await page.close();
    }
  }
  console.log(JSON.stringify({ results, screenshots: output, backendWrites: 0 }, null, 2));
} finally { await browser.close(); }
