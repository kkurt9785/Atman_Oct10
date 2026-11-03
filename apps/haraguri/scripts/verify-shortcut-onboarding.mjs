// Mobile browser + real HARAGURI backend, isolated temporary account; no emails.
// Never prints pairing codes, collection addresses, auth sessions or keys.
// Walks the 가계부 auto-collect card: 단축어 추가 → 다 했어요 → 연결하기 (code + shortcuts:// link) → claim → 연결됨 ✓ → 수집 중 ✓,
// then checks that a rotated collection address needs fresh evidence and that the /pair callback retries once.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const readEnv = file => Object.fromEntries(readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const cfg = { ...readEnv('../.env.local'), ...readEnv('../.env.supabase-admin') };
assert.equal(cfg.NEXT_PUBLIC_SUPABASE_URL, 'https://rwyvqxkweqsoositvlht.supabase.co');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, options);
const client = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const check = (r, step) => { if (r.error) throw new Error(`${step}: ${r.error.message}`); return r.data; };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || '/Users/kihankim/lumenix/main/node_modules/playwright-core');
let userId, familyId, browser, card, errors = [], consoleErrors = [];
try {
  const email = `haraguri-shortcut-${randomUUID()}@example.invalid`;
  userId = check(await admin.auth.admin.createUser({ email, email_confirm: true }), 'create temporary user').user.id;
  const magic = check(await admin.auth.admin.generateLink({ type: 'magiclink', email }), 'create temporary login');
  const session = check(await client.auth.verifyOtp({ token_hash: magic.properties.hashed_token, type: 'magiclink' }), 'temporary login').session;
  familyId = check(await client.rpc('hg_create_family', { family_name: '단축어 연결 QA', member_name: '검증 사용자' }), 'create temporary family');
  const original = check(await client.from('hg_ingest_tokens').insert({ family_id: familyId, user_id: userId }).select('token').single(), 'seed existing SMS token');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'], userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  // RPC trace for diagnostics (paths only, never bodies).
  const t0 = Date.now(); const rpc = [];
  page.on('request', r => { if (r.url().includes('/rest/v1/rpc/')) rpc.push(`${((Date.now() - t0) / 1000).toFixed(1)}s → ${r.url().split('/rpc/')[1]}`); });
  page.on('requestfinished', r => { if (r.url().includes('/rest/v1/rpc/')) rpc.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ✓ ${r.url().split('/rpc/')[1]}`); });
  page.on('requestfailed', r => { if (r.url().includes('/rest/v1/rpc/')) rpc.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ✗ ${r.url().split('/rpc/')[1]} ${r.failure()?.errorText}`); });
  globalThis.__rpc = rpc;
  await page.addInitScript(session => localStorage.setItem('haraguri-auth', JSON.stringify(session)), session);
  // Headless Chromium's async clipboard can hang after a shortcuts:// launch attempt; this run checks the UI flow, not the clipboard.
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => undefined, write: async () => undefined }, configurable: true }); });
  const base = process.env.BASE_URL || 'http://127.0.0.1:3014';
  await page.goto(`${base}/?tab=money&collect=1`);
  await page.getByRole('heading', { name: '가계부', exact: true }).waitFor();
  card = page.locator('.autocollect-card');
  const openLink = card.getByRole('link', { name: '단축어 열기', exact: true });
  // Interval polling: rAF-based polling stalls if headless Chromium marks the page hidden after a shortcuts:// launch attempt.
  const hrefChanged = previous => page.waitForFunction(p => Array.from(document.querySelectorAll('.autocollect-card a')).some(a => a.textContent === '단축어 열기' && a.getAttribute('href') !== p), previous, { polling: 500 });
  const manifest = await page.request.get(new URL('/haraguri-notifications.json', page.url()).href);
  const release = await manifest.json();
  assert.equal(await page.getByRole('navigation', { name: '모바일 메뉴' }).getByRole('button').count(), 4, 'bottom nav keeps four tabs');
  await page.getByRole('button', { name: '설정', exact: true }).first().waitFor();
  // 1 · 단축어 추가: jumps straight into the Shortcuts add sheet; the iCloud page stays as a fallback link
  const install = card.getByRole('link', { name: '단축어 추가', exact: true });
  await install.waitFor();
  assert.equal(await install.getAttribute('href'), `shortcuts://import-shortcut?url=${encodeURIComponent(release.icloud_url)}`);
  assert.equal(await card.getByRole('link', { name: 'iCloud에서 열기', exact: true }).getAttribute('href'), release.icloud_url);
  assert.equal(await card.getByRole('link', { name: '단축어 받기', exact: true }).count(), 0, 'no .shortcut download on an iCloud install');
  await card.getByRole('button', { name: '이미 추가했어요', exact: true }).click();
  // 2 · 내 계정 연결: straight after install — no "automation on" confirmation step; one tap makes a code and offers the shortcuts:// link
  await card.getByRole('heading', { name: '내 계정 연결' }).waitFor();
  await card.getByRole('button', { name: '연결하기', exact: true }).click();
  await openLink.waitFor();
  const first = new URL(await openLink.getAttribute('href'));
  assert.equal(first.protocol, 'shortcuts:');
  assert.equal(first.searchParams.get('name'), release.name.normalize(release.name_normalization || 'NFC'));
  const code1 = first.searchParams.get('text');
  assert.ok(/^[0-9a-f]{48}$/.test(code1), 'link carries a pairing code');
  assert.ok(code1 !== original.token, 'link never carries the existing SMS token');
  assert.equal(await card.locator('code.pair-code').textContent(), code1, 'the same code is shown for the clipboard path');
  // After a shortcuts:// launch attempt headless Chromium drops real pointer clicks on the page; DOM-dispatched clicks still reach React.
  // includeHidden: the name-fallback button lives inside the collapsed <details>.
  const tap = name => card.getByRole('button', { name, exact: true, includeHidden: true }).dispatchEvent('click');
  await tap('새 코드로 다시');
  await hrefChanged(first.href);
  const second = new URL(await openLink.getAttribute('href'));
  const code = second.searchParams.get('text');
  assert.notEqual(code, code1, 'a failed connection can be retried immediately with a fresh code');
  await tap('다른 이름으로 다시 열기');
  await hrefChanged(second.href);
  const alternate = new URL(await openLink.getAttribute('href'));
  assert.equal(alternate.searchParams.get('text'), code, 'name fallback keeps the same unused code');
  assert.equal(alternate.searchParams.get('name'), release.name.normalize(release.name_normalization === 'NFD' ? 'NFC' : 'NFD'));
  assert.equal(await card.getByRole('button', { name: '다른 이름으로 다시 열기', exact: true }).count(), 0, 'name fallback is offered once');
  // The shortcut claims the code and pings the address, as the real one does after '항상 허용'.
  const paired = await post(`${cfg.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/shortcut-pair`, { code });
  assert.equal(paired.status, 200);
  const data = await paired.json();
  assert.equal(data.collect_url, `${cfg.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ingest?token=${original.token}`, 'pairing keeps the existing collection address');
  assert.ok((await (await post(data.collect_url, { body: '하라구리 연결 테스트', via: 'ios-notification-setup' })).json()).test);
  await card.getByRole('heading', { name: '연결됨 ✓ · 첫 결제 알림 기다리는 중' }).waitFor({ timeout: 15000 });
  assert.equal(await card.getByRole('heading', { name: '수집 중 ✓' }).count(), 0, 'a setup ping is not a real payment');
  assert.equal(check(await client.from('hg_expenses').select('id').eq('family_id', familyId), 'no expenses from setup').length, 0);
  await card.screenshot({ path: '/private/tmp/haraguri-shortcut-pairing-mobile.png' });
  assert.ok((await (await post(data.collect_url, { body: 'QA 스타벅스에서 10,000원 결제되었어요', app: 'KB Pay', via: 'ios-notification' })).json()).saved, 'real-shaped notification saves an expense');
  await card.getByRole('heading', { name: '수집 중 ✓' }).waitFor({ timeout: 15000 });
  await page.locator('.autocollect-line').filter({ hasText: '수집 중 ✓' }).waitFor();
  await card.screenshot({ path: '/private/tmp/haraguri-shortcut-payment-mobile.png' });
  check(await admin.from('hg_inbox').insert(Array.from({ length: 31 }, () => ({ family_id: familyId, user_id: userId, via: 'ios-notification', app: 'QA', raw: '포인트 안내', status: 'ignored', summary: 'QA 이벤트 알림' }))), 'push connection evidence beyond inbox window');
  await page.goto(`${base}/?tab=money&collect=1`);
  await card.getByRole('heading', { name: '수집 중 ✓' }).waitFor({ timeout: 15000 });
  assert.equal(await card.getByRole('link', { name: '단축어 추가', exact: true }).count(), 0, 'a connected phone is not asked to install again after thirty alerts');
  // Historical success must not confirm a newly rotated collection address.
  check(await client.from('hg_ingest_tokens').delete().eq('family_id', familyId).eq('user_id', userId), 'rotate collection address');
  check(await client.from('hg_ingest_tokens').insert({ family_id: familyId, user_id: userId }), 'new collection address');
  await card.getByRole('heading', { name: '내 계정 연결' }).waitFor({ timeout: 15000 });
  assert.equal(await card.getByRole('heading', { name: '수집 중 ✓' }).count(), 0, 'old payments cannot confirm a new address');
  await card.getByRole('button', { name: '연결하기', exact: true }).waitFor();
  assert.equal(check(await client.from('hg_inbox').select('id').eq('family_id', familyId), 'historical inbox').length, 34, 'rotating an address preserves the historical inbox');
  // Error callback retries the same unused code in NFD once, never after claim.
  const retry = check(await client.rpc('hg_create_shortcut_pairing', { family: familyId }), 'retry code');
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/pair?pairRetry=nfd&code=${retry.code}`);
  const retryLink = page.getByRole('link', { name: '단축어로 연결 계속하기' });
  await retryLink.waitFor();
  const nfd = new URL(await retryLink.getAttribute('href'));
  assert.equal(nfd.searchParams.get('name'), release.name.normalize('NFD'));
  assert.equal(nfd.searchParams.get('text'), retry.code);
  assert.equal(new URL(page.url()).search, '', 'callback code is stripped');
  await page.goto(`${origin}/pair?pairRetry=nfd&code=${retry.code}`);
  await page.getByRole('status').filter({ hasText: '단축어를 열지 못했어요' }).waitFor();
  assert.equal(await retryLink.count(), 0, 'second callback does not launch again');
  assert.equal((await post(`${cfg.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/shortcut-pair`, { code: retry.code })).status, 200);
  await page.goto(`${origin}/pair?pairRetry=nfd&code=${retry.code}`);
  await page.getByRole('status').filter({ hasText: '연결 정보가 단축어에 전달됐어요' }).waitFor();
  assert.equal(await retryLink.count(), 0, 'a consumed code is not relaunched');
  assert.deepEqual(errors, []);
  console.log('PASS: four-tab nav + 설정 button; 가계부 card walks 추가 → 연결하기 (two steps) with a fresh code per tap and one name fallback; setup ping ≠ payment; 수집 중 ✓ survives thirty alerts; rotated address needs fresh evidence; /pair callback retries once.');
} catch (e) {
  // Diagnostics on failure: card text with any 48-hex code masked, plus page/console errors.
  const text = await card?.innerText().catch(() => '') ?? '';
  console.error('card text:', text.replace(/[0-9a-f]{48}/g, '<code>').replace(/\s+/g, ' ').slice(0, 900));
  console.error('page errors:', errors, 'console errors:', consoleErrors.slice(0, 8));
  console.error('retry button disabled:', await card?.getByRole('button', { name: '새 코드로 다시', exact: true }).isDisabled().catch(() => 'n/a'));
  console.error('visibility:', await card?.page().evaluate(() => `${document.visibilityState} focus=${document.hasFocus()} url=${location.href.slice(0, 60)}`).catch(() => 'n/a'));
  console.error('rpc trace:', JSON.stringify(globalThis.__rpc ?? []));
  throw e;
} finally {
  await browser?.close();
  if (familyId) check(await admin.from('hg_families').delete().eq('id', familyId), 'clean temporary family');
  if (userId) check(await admin.auth.admin.deleteUser(userId), 'clean temporary user');
  console.log('Temporary shortcut onboarding data cleaned up.');
}
