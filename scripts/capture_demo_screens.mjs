import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = process.argv[2] ?? 'worker';
const port = target.startsWith('admin') ? 9332 : 9333;
const root = `/private/tmp/atman-video-${target}`;
const adminOrigin = target === 'admin-live' ? 'https://admin.itdot.co.kr' : 'http://localhost:3002';
const workerOrigin = target === 'worker-live' ? 'https://itdot.co.kr' : 'http://localhost:3003';

async function authStorageKey() {
  const env = await fs.readFile('apps/admin-web/.env.local', 'utf8');
  const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
  if (!match) throw new Error('Supabase 브라우저 설정을 찾지 못했습니다.');
  return `sb-${new URL(match[1].trim()).hostname.split('.')[0]}-auth-token`;
}

async function adminDemoCredentials(email) {
  const env = await fs.readFile('apps/admin-web/.env.local', 'utf8');
  const value = (name) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  const url = value('SUPABASE_URL') ?? value('NEXT_PUBLIC_SUPABASE_URL');
  const anon = value('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRole = value('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !serviceRole) throw new Error('관리자 데모 계정 환경설정을 찾지 못했습니다.');
  const linkResponse = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const link = await linkResponse.json().catch(() => ({}));
  if (!linkResponse.ok || !link.hashed_token) throw new Error('관리자 데모 로그인 링크를 만들지 못했습니다.');
  const response = await fetch(`${url}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: link.verification_type ?? 'magiclink', token_hash: link.hashed_token }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token || !data.refresh_token) throw new Error('관리자 데모 계정 세션을 만들지 못했습니다.');
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

function getJson(path) {
  return new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path }, (res) => {
    let body = ''; res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject));
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function frame(text) {
  const payload = Buffer.from(text); const mask = crypto.randomBytes(4); let head;
  if (payload.length < 126) head = Buffer.from([0x81, 0x80 | payload.length]);
  else if (payload.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}
async function connect(wsUrl) {
  const url = new URL(wsUrl); const key = crypto.randomBytes(16).toString('base64');
  const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
  const pending = new Map(); let seq = 0; let buffer = Buffer.alloc(0); let ready = false;
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!ready) { const at = buffer.indexOf('\r\n\r\n'); if (at < 0) return; buffer = buffer.subarray(at + 4); ready = true; }
    while (buffer.length >= 2) {
      const lengthCode = buffer[1] & 0x7f; let offset = 2; let length = lengthCode;
      if (lengthCode === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      if (lengthCode === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (buffer.length < offset + length) return;
      const payload = buffer.subarray(offset, offset + length); buffer = buffer.subarray(offset + length);
      if ((buffer[0] & 0x0f) === 0x8) return;
      try { const message = JSON.parse(payload.toString()); if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); } } catch { /* CDP events are not needed here */ }
    }
  });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.write(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await new Promise((resolve) => { const timer = setInterval(() => { if (ready) { clearInterval(timer); resolve(); } }, 20); });
  return { send(method, params = {}) { const id = ++seq; socket.write(frame(JSON.stringify({ id, method, params }))); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }, close() { socket.end(); } };
}
async function startChrome() {
  const child = spawn(chrome, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${root}/profile`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 30; i += 1) { try { const pages = await getJson('/json/list'); const page = pages.find((item) => item.type === 'page'); if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl; } catch {} await sleep(250); }
  throw new Error('Chrome DevTools를 시작하지 못했습니다.');
}
async function main() {
  await fs.mkdir(root, { recursive: true });
  const cdp = await connect(await startChrome());
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  async function go(url) { await cdp.send('Page.navigate', { url }); await sleep(2200); }
  async function shot(name) {
    // The PWA install banner is fixed to the bottom and would cover every frame;
    // dismiss it right before capturing (no-op on admin, which has no banner).
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('button[aria-label="설치 안내 닫기"]')?.click(); true` });
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(`${root}/${name}.png`, Buffer.from(data, 'base64'));
  }
  if (target === 'worker' || target === 'worker-live') {
    await go(`${workerOrigin}/worker-intro`); await shot('01-worker-intro');
    await go(`${workerOrigin}/onboarding?step=splash`); await shot('02-worker-register');
    if (target === 'worker-live') {
      const loginResponse = await fetch('https://itdot.co.kr/api/demo-login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'worker-demo-1@demo.atman.co.kr' }),
      });
      const login = await loginResponse.json();
      if (!login.accessToken || !login.refreshToken) throw new Error('시연 워커 세션을 가져오지 못했습니다.');
      const payload = JSON.parse(Buffer.from(login.accessToken.split('.')[1], 'base64url').toString());
      const session = { access_token: login.accessToken, refresh_token: login.refreshToken, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { id: payload.sub, email: 'worker-demo-1@demo.atman.co.kr', aud: 'authenticated', role: 'authenticated' } };
      const key = await authStorageKey();
      await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))}); true` });
      await cdp.send('Page.reload'); await sleep(4500);
    }
    await go(`${workerOrigin}/settings/location`); await shot('03-activity-area');
    await go(`${workerOrigin}/home`); await shot('04-home');
    await go(`${workerOrigin}/shifts`); await shot('05-shifts');
    await go(`${workerOrigin}/applications`); await shot('06-applications');
    // Chat links only render on accepted/completed cards, which live under the
    // "확정 근무" tab — the default "진행 중" tab shows pending applications without them.
    await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim().startsWith('확정 근무'))?.click(); true` });
    await sleep(1200);
    // The applications list loads asynchronously on production; poll for the
    // chat link instead of assuming it is present after the fixed navigation wait.
    let href = null;
    for (let attempt = 0; attempt < 16 && typeof href !== 'string'; attempt += 1) {
      const chatHref = await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('a[href^="/chat/"]')).map((node) => node.getAttribute('href')).find(Boolean) ?? null`, returnByValue: true });
      href = chatHref?.result?.value;
      if (typeof href !== 'string') await sleep(500);
    }
    if (typeof href === 'string') {
      await go(`${workerOrigin}${href}`);
      // The seeded showcase already holds a facility → worker exchange, which is
      // the cleanest chat frame. Do not send quick replies here: every capture run
      // would append more worker bubbles and the scene turns into a monologue.
      await sleep(700); await shot('07-chat');
    }
    await go(`${workerOrigin}/workplace`); await shot('08-workplace');
    await go(`${workerOrigin}/store/credits`); await shot('09-payments');
    await go(`${workerOrigin}/notifications`); await shot('10-notifications');
    await go(`${workerOrigin}/home`); await shot('11-next-shifts');
  } else {
    await go('https://itdot.co.kr/intro'); await shot('01-service-intro');
    await go(`${adminOrigin}/login`); await shot('01-login');
    // Set the same Supabase session that the login UI creates. The local dev
    // server can be running with an older public demo flag, so this capture
    // helper obtains the permitted demo credentials directly and only uses
    // them within its isolated Chrome profile.
    const credentials = await adminDemoCredentials('sales-demo-1@demo.atman.co.kr');
    const adminSession = `
      (async () => {
        const headers = { Authorization: 'Bearer ' + ${JSON.stringify(credentials.accessToken)}, 'content-type': 'application/json' };
        const session = await fetch('/api/admin-session', { method: 'POST', headers });
        if (!session.ok) throw new Error('관리자 세션 설정 실패');
        const facility = await fetch('/api/set-facility', { method: 'POST', headers, body: '{}' });
        if (!facility.ok) throw new Error('시연 사업장 설정 실패');
        return true;
      })()
    `;
    // AuthGuard also verifies the Supabase browser session, so the token used
    // to establish the server cookie above must be present in localStorage.
    const payload = JSON.parse(Buffer.from(credentials.accessToken.split('.')[1], 'base64url').toString());
    const session = { access_token: credentials.accessToken, refresh_token: credentials.refreshToken, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { id: payload.sub, email: 'sales-demo-1@demo.atman.co.kr', aud: 'authenticated', role: 'authenticated' } };
    const key = await authStorageKey();
    await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))}); true` });
    await cdp.send('Runtime.evaluate', { expression: adminSession, awaitPromise: true });
    const beforeReload = await cdp.send('Runtime.evaluate', {
      expression: `({ hasBrowserSession: Boolean(localStorage.getItem(${JSON.stringify(key)})), adminCookie: document.cookie.includes('atman_admin') })`, returnByValue: true,
    });
    console.log('ADMIN_SESSION', JSON.stringify(beforeReload?.result?.value ?? {}));
    await cdp.send('Page.reload'); await sleep(4500);
    await go(`${adminOrigin}/`); await sleep(3500);
    const adminView = await cdp.send('Runtime.evaluate', { expression: `(async () => {
      const status = await fetch('/api/admin-session', { method: 'POST', headers: { Authorization: 'Bearer ' + ${JSON.stringify(credentials.accessToken)} } }).then((response) => response.status).catch(() => 0);
      return { view: document.body.innerText.slice(0, 400), hasBrowserSession: Boolean(localStorage.getItem(${JSON.stringify(key)})), adminSessionStatus: status };
    })()`, awaitPromise: true, returnByValue: true });
    console.log('ADMIN_VIEW', JSON.stringify(adminView?.result?.value ?? {}));
    await shot('02-home');
    // 0. 사업장 등록 — 이름 검색(카카오·잇닿 DB) → 지도 결과 카드 → 등록 시트(핀 조정 지도).
    // 등록 버튼은 누르지 않는다(시연 계정은 이미 사업장을 소유). 검색어는 지역어+이름 조합이 결과가 좋다.
    await go(`${adminOrigin}/setup/claim-facility`);
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('input[aria-label="사업장명 검색"]')?.focus(); true` });
    await cdp.send('Input.insertText', { text: '수원 온누리약국' });
    await sleep(300);
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('button[aria-label="검색"]')?.click(); true` });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const count = await cdp.send('Runtime.evaluate', { expression: `document.querySelectorAll('ul li button').length`, returnByValue: true });
      if ((count?.result?.value ?? 0) > 0) break;
      await sleep(500);
    }
    await sleep(400); await shot('00-facility-search');
    await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('ul li button')).find((node) => node.textContent?.includes('바로 등록 가능'))?.click(); true` });
    await sleep(4000); // 카카오맵 타일·핀·반경 원 렌더 대기
    await shot('00-facility-register');
    await go(`${adminOrigin}/shifts/new`); await shot('02-shift-create');
    await go(`${adminOrigin}/applications`); await shot('03-applications');
    await go(`${adminOrigin}/chats`); await shot('04-chats');
    await go(`${adminOrigin}/timesheet`); await shot('05-timesheet');
    await go(`${adminOrigin}/payroll`); await shot('07-payroll');
    await go(`${adminOrigin}/attendance-qr`); await shot('06-attendance-auth');
    await cdp.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 780); true', awaitPromise: true }); await sleep(800); await shot('06-attendance-methods');
    await go(`${adminOrigin}/notifications`); await shot('06-notifications');
  }
  cdp.close(); console.log(root);
}
main().catch((error) => { console.error(error); process.exit(1); });
