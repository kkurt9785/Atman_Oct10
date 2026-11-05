// Isolated React UI regression for the gig "새 사람 초대" form that registers several people at once
// (components/gig/GigInviteBatchForm.tsx). The server action, next/link and next/navigation are replaced at bundle time.
// No login, backend connection, invite creation or production write is performed.
// Usage: node scripts/qa-admin-bulk-invite-ui.mjs /absolute/path/to/playwright-core
// CSS: uses apps/admin-web/.next/static/css when a production build exists, otherwise compiles Tailwind locally.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { build } = require('../apps/worker-web/node_modules/esbuild');
const app = path.resolve('apps/admin-web');

const resolveAlias = (spec) => {
  const base = path.join(app, spec.slice(2));
  const hit = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext).find((file) => existsSync(file));
  if (!hit) throw new Error(`cannot resolve ${spec}`);
  return hit;
};
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import { flushSync } from 'react-dom';
    import { createRoot } from 'react-dom/client';
    import { GigInviteBatchForm } from './components/gig/GigInviteBatchForm';
    window.calls = []; window.refreshes = 0; window.copied = [];
    // 공유 시트가 없는 PC처럼: 복사 경로로 떨어지게 하고, 복사 내용은 기록만 한다
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.copied.push(text); } }, configurable: true });
    const root = createRoot(document.getElementById('root'));
    let version = 0;
    // flushSync: 새로 마운트가 끝난 뒤에 다음 단계가 입력하도록 (concurrent root 의 render 는 비동기)
    window.mount = () => { version++; flushSync(() => root.render(<GigInviteBatchForm key={version} projectId="qa-project" workerOrigin="https://itdot.example" />)); };
    window.mount();
  `, loader: 'tsx', resolveDir: app },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated', setup(build) {
    build.onResolve({ filter: /^@\/lib\/actions\/gig-projects$/ }, () => ({ path: 'mock-actions', namespace: 'qa' }));
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'mock-link', namespace: 'qa' }));
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'mock-navigation', namespace: 'qa' }));
    build.onLoad({ filter: /^mock-actions$/, namespace: 'qa' }, () => ({ contents: `
      export const runGigProjectAction = (kind, form) => new Promise(resolve => window.calls.push({ kind, data: Object.fromEntries(form), resolve }));
    ` }));
    build.onLoad({ filter: /^mock-link$/, namespace: 'qa' }, () => ({ loader: 'tsx', resolveDir: app, contents: `
      export default function Link({ href, children, ...rest }) { return <a href={href} {...rest}>{children}</a>; }
    ` }));
    build.onLoad({ filter: /^mock-navigation$/, namespace: 'qa' }, () => ({ contents: `
      const router = { refresh: () => { window.refreshes++; }, push() {}, replace() {} };
      export const useRouter = () => router;
    ` }));
    build.onResolve({ filter: /^@\// }, args => ({ path: resolveAlias(args.path) }));
  } }],
});

async function loadCss() {
  const cssDir = path.join(app, '.next/static/css');
  // `next build` leaves hashed .css files here; a running `next dev` only leaves a subfolder, so fall back to compiling
  const built = existsSync(cssDir) ? (await readdir(cssDir)).filter(file => file.endsWith('.css')) : [];
  if (built.length) return (await Promise.all(built.map(file => readFile(path.join(cssDir, file), 'utf8')))).join('\n');
  const postcss = require('../apps/admin-web/node_modules/postcss');
  const tailwind = require('../apps/admin-web/node_modules/tailwindcss');
  const source = await readFile(path.join(app, 'app/globals.css'), 'utf8');
  const cwd = process.cwd();
  process.chdir(app); // tailwind.config.ts content globs are relative to the app folder
  try { return (await postcss([tailwind(path.join(app, 'tailwind.config.ts'))]).process(source, { from: path.join(app, 'app/globals.css') })).css; }
  finally { process.chdir(cwd); }
}
const css = await loadCss();
const directory = await mkdtemp(path.join(tmpdir(), 'itdot-bulk-invite-'));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    await page.route('**/*', route => route.abort());
    // Same nesting as /gig-work/[id]: main px-4 → section p-5 → form.
    await page.setContent('<html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main class="px-4 pb-28"><section class="mt-4 rounded-2xl bg-white p-5 shadow-card"><div id="root"></div></section></main></body></html>');
    assert.equal(await page.evaluate(() => innerWidth), width);
    await page.addStyleTag({ content: css.replace(/@import\s+[^;]+;/g, '') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const checks = [];
    const pass = (label) => checks.push(label);
    const count = () => page.evaluate(() => window.calls.length);
    const last = () => page.evaluate(() => { const call = window.calls.at(-1); return { kind: call.kind, projectId: call.data.project_id, people: JSON.parse(call.data.people) }; });
    const settle = (value) => page.evaluate(value => window.calls.at(-1).resolve(value), value);
    const noOverflow = async (label) => {
      const wide = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const out = [...document.querySelectorAll('#root *')].filter(el => el.getBoundingClientRect().right > limit + 0.5).map(el => el.tagName + ':' + (el.textContent ?? '').slice(0, 20));
        return { scroll: document.documentElement.scrollWidth <= innerWidth, out };
      });
      assert.equal(wide.scroll, true, `${label}: page scrolls sideways`);
      assert.deepEqual(wide.out, [], `${label}: elements past the right edge`);
    };
    const focused = (label) => page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, label, { timeout: 3000 });
    const nameInputs = () => page.locator('input[aria-label$="이름"]');
    const phoneInputs = () => page.locator('input[aria-label*="휴대전화"]');
    const values = (locator) => locator.evaluateAll(list => list.map(input => input.value));
    const paste = (index, text) => nameInputs().nth(index).evaluate((input, text) => {
      const data = new DataTransfer(); data.setData('text/plain', text);
      input.focus(); input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);

    // 1) Single person: same inputs and button as before, one request, one big invite button pair.
    await page.getByRole('textbox', { name: '이름', exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder('휴대전화 · 선택').count(), 1);
    await page.getByText("여러 명이면 '+ 한 명 더'를 누르거나").waitFor();
    await page.getByRole('button', { name: '등록하고 일회용 초대 만들기' }).click();
    await page.getByRole('alert').filter({ hasText: '초대할 사람의 이름을 입력해 주세요.' }).waitFor();
    assert.equal(await count(), 0, 'empty submit sends nothing');
    await page.getByRole('textbox', { name: '이름', exact: true }).fill('김하늘');
    await page.getByRole('button', { name: '등록하고 일회용 초대 만들기' }).evaluate(button => { button.click(); button.click(); });
    await page.getByText('처리 중...').waitFor();
    assert.equal(await count(), 1, 'single flight');
    assert.equal(await page.evaluate(() => document.querySelector('fieldset').disabled), true, 'inputs locked while saving');
    assert.deepEqual(await last(), { kind: 'invite_participants', projectId: 'qa-project', people: [{ name: '김하늘', phone: '' }] });
    await settle({ ok: true, data: { limit: 3, results: [{ name: '김하늘', ok: true, inviteToken: 'tok-single' }] } });
    await page.getByRole('status').filter({ hasText: '등록했어요 · 근무자가 직접 수락할 초대를 보내 주세요' }).waitFor();
    await page.getByRole('button', { name: '카카오·메시지로 초대' }).click();
    const singleCopy = await page.evaluate(() => window.copied.at(-1));
    assert.ok(singleCopy.startsWith('[잇닿] 근무 초대가 왔어요.') && singleCopy.endsWith('https://itdot.example/gig/join?token=tok-single'), 'single copy = message + link');
    await page.getByRole('button', { name: '현장 QR' }).waitFor();
    assert.deepEqual(await values(nameInputs()), [''], 'form clears after success');
    assert.equal(await page.evaluate(() => window.refreshes), 1);
    await noOverflow('single');
    pass('single-name path unchanged (1 request, invite + QR, copy text)');

    // 2) Three people typed: Enter moves to a new row (never submits), '+ 한 명 더' adds and focuses a row.
    await page.evaluate(() => window.mount());
    await page.getByRole('textbox', { name: '이름', exact: true }).fill('김하늘');
    await page.getByRole('textbox', { name: '이름', exact: true }).press('Enter');
    assert.equal(await count(), 1, 'Enter does not submit');
    await focused('2번째 사람 이름');
    await page.keyboard.type('이바다');
    await page.getByRole('button', { name: '+ 한 명 더' }).click();
    await focused('3번째 사람 이름');
    await page.keyboard.type('박구름');
    await page.getByRole('textbox', { name: '3번째 사람 휴대전화 (선택)' }).fill('010-1234-5678');
    await page.getByRole('button', { name: '+ 한 명 더' }).click(); // a blank trailing row is ignored
    await page.getByRole('button', { name: '4번째 사람 줄 빼기' }).click();
    assert.equal(await nameInputs().count(), 3);
    assert.equal(await page.getByRole('textbox', { name: '3번째 사람 휴대전화 (선택)' }).evaluate(input => input.scrollWidth <= input.clientWidth), true, 'full phone number visible');
    await noOverflow('three rows');
    await page.screenshot({ path: path.join(directory, `${width}-1-three-rows.png`), fullPage: true });
    await page.getByRole('button', { name: '3명 등록하고 초대 만들기' }).click();
    await page.getByText('3명을 차례로 등록하고 있어요. 잠시만 기다려 주세요.').waitFor();
    assert.deepEqual((await last()).people, [{ name: '김하늘', phone: '' }, { name: '이바다', phone: '' }, { name: '박구름', phone: '010-1234-5678' }]);
    await settle({ ok: true, data: { limit: 10, results: [
      { name: '김하늘', ok: true, inviteToken: 'tok-1' }, { name: '이바다', ok: true, inviteToken: 'tok-2' }, { name: '박구름', ok: true, inviteToken: 'tok-3' },
    ] } });
    await page.getByRole('status').filter({ hasText: '3명 등록했어요 · 초대는 사람마다 따로예요. 한 명씩 보내 주세요' }).waitFor();
    const list = page.getByRole('list', { name: '방금 등록한 사람' });
    assert.deepEqual(await list.locator('li b').allInnerTexts(), ['김하늘', '이바다', '박구름']);
    assert.equal(await list.getByRole('button', { name: '초대 보내기' }).count(), 3);
    assert.equal(await list.getByRole('button', { name: '현장 QR' }).count(), 3);
    await list.locator('li').nth(1).getByRole('button', { name: '초대 보내기' }).click();
    assert.ok((await page.evaluate(() => window.copied.at(-1))).endsWith('/gig/join?token=tok-2'), 'each row copies its own link');
    await list.locator('li').nth(1).getByText('초대 문구 복사됨 · 카톡에 붙여넣기').waitFor();
    await noOverflow('three added + copied label');
    assert.equal(await page.getByRole('button', { name: /모두|전체|한꺼번에/ }).count(), 0, 'no copy-all button');
    assert.deepEqual(await values(nameInputs()), ['']);
    await page.screenshot({ path: path.join(directory, `${width}-2-three-added.png`), fullPage: true });
    pass('batch of 3 → 3 rows each with own invite + QR, no copy-all');

    // 3) Pasted roster (카톡·엑셀) splits into rows; person 3 of 5 fails, the others stay added.
    await page.evaluate(() => window.mount());
    await paste(0, '1. 김하늘 010-1111-2222\n이바다\n박구름\t01033334444\n\n최노을\n정새벽');
    assert.deepEqual(await values(nameInputs()), ['김하늘', '이바다', '박구름', '최노을', '정새벽']);
    assert.deepEqual(await values(phoneInputs()), ['010-1111-2222', '', '01033334444', '', '']);
    await page.getByRole('button', { name: '5명 등록하고 초대 만들기' }).click();
    assert.equal((await last()).people.length, 5);
    await settle({ ok: true, data: { limit: 10, results: [
      { name: '김하늘', ok: true, inviteToken: 'tok-a' }, { name: '이바다', ok: true, inviteToken: 'tok-b' },
      { name: '박구름', ok: false, error: '근무자를 등록하지 못했어요.' },
      { name: '최노을', ok: true, inviteToken: 'tok-d' }, { name: '정새벽', ok: true, inviteToken: 'tok-e' },
    ] } });
    await page.getByRole('status').filter({ hasText: '5명 중 4명 등록했어요' }).waitFor();
    assert.deepEqual(await page.getByRole('list', { name: '방금 등록한 사람' }).locator('li b').allInnerTexts(), ['김하늘', '이바다', '최노을', '정새벽']);
    const failure = page.getByRole('alert').filter({ hasText: '1명은 등록하지 못했어요' });
    await failure.waitFor();
    await failure.getByText('박구름 · 근무자를 등록하지 못했어요.').waitFor();
    assert.deepEqual(await values(nameInputs()), ['박구름'], 'failed person stays in the form');
    assert.deepEqual(await values(phoneInputs()), ['01033334444']);
    await noOverflow('partial failure');
    await page.screenshot({ path: path.join(directory, `${width}-3-partial-failure.png`), fullPage: true });
    pass('pasted roster splits rows; partial failure lists who and why, others stay added');

    // 4) Capacity: 1 slot left, 4 people → 1 added, 3 told why and kept in the form, link to 이용 현황.
    await page.evaluate(() => window.mount());
    await paste(0, '김하늘\n이바다\n박구름\n최노을');
    await page.getByRole('button', { name: '4명 등록하고 초대 만들기' }).click();
    await settle({ ok: true, data: { limit: 3, results: [
      { name: '김하늘', ok: true, inviteToken: 'tok-x' },
      { name: '이바다', ok: false, overCapacity: true }, { name: '박구름', ok: false, overCapacity: true }, { name: '최노을', ok: false, overCapacity: true },
    ] } });
    await page.getByRole('status').filter({ hasText: '4명 중 1명 등록했어요 · 근무자가 직접 수락할 초대를 보내 주세요' }).waitFor();
    await page.getByRole('button', { name: '카카오·메시지로 초대' }).waitFor();
    const cap = page.getByRole('alert').filter({ hasText: '3명은 인원 한도 때문에 등록하지 못했어요' });
    await cap.waitFor();
    await cap.getByText('지금 이용 중인 요금으로는 한 현장에 3명까지 등록할 수 있어요. 수락을 기다리는 초대와 아직 시작 전인 근무자도 함께 세요.').waitFor();
    await cap.getByText('못 넣은 사람: 이바다, 박구름, 최노을 · 입력칸에 그대로 남겨 뒀어요.').waitFor();
    assert.equal(await cap.getByRole('link', { name: '이용 현황 보기 →' }).getAttribute('href'), '/membership');
    assert.deepEqual(await values(nameInputs()), ['이바다', '박구름', '최노을']);
    await noOverflow('capacity');
    await page.screenshot({ path: path.join(directory, `${width}-4-capacity.png`), fullPage: true });
    pass('capacity exceeded: added vs not-added counts, reason, names kept');

    // 5) Whole request refused (e.g. project gone): message shown, nothing lost.
    await page.getByRole('button', { name: '3명 등록하고 초대 만들기' }).click();
    await settle({ ok: false, error: '근무 건을 찾을 수 없어요.' });
    await page.getByRole('alert').filter({ hasText: '근무 건을 찾을 수 없어요.' }).waitFor();
    assert.deepEqual(await values(nameInputs()), ['이바다', '박구름', '최노을']);
    pass('whole-batch error keeps rows');

    // 6) Guards: phone without name blocked before sending; roster over 20 is cut with the leftover names shown.
    const before = await count();
    await page.evaluate(() => window.mount());
    await page.getByRole('textbox', { name: '휴대전화 (선택)' }).fill('010-9999-0000');
    await page.getByRole('button', { name: '등록하고 일회용 초대 만들기' }).click();
    await page.getByRole('alert').filter({ hasText: '전화번호만 있고 이름이 없는 줄이 있어요.' }).waitFor();
    assert.equal(await count(), before);
    await page.evaluate(() => window.mount());
    await paste(0, Array.from({ length: 22 }, (_, i) => `근무자${i + 1}`).join('\n'));
    assert.equal(await nameInputs().count(), 20);
    await page.getByText('넣지 못한 2명(근무자21, 근무자22)은 이번 등록이 끝난 뒤 다시 넣어 주세요.').waitFor();
    assert.equal(await page.getByRole('button', { name: '한 번에 20명까지 넣을 수 있어요' }).isDisabled(), true);
    await noOverflow('20 rows');
    pass('guards: phone-only row, 20-person cap with leftovers named');

    assert.deepEqual(errors, []);
    pass('no horizontal overflow or console errors');
    results.push({ width, checks });
    await page.close();
  }
  console.log(JSON.stringify({ results, screenshots: directory, realBackendWrites: 0 }, null, 2));
} finally { await browser.close(); }
