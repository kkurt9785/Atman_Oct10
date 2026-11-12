import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = process.argv[2] ?? 'worker';
// 고정 포트(9332·9333)는 다른 Chrome 디버그 세션과 부딪혀 엉뚱한 브라우저를 조종할 수 있다 — 실행마다 빈 포트를 고른다
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port: free } = server.address(); server.close(() => resolve(free)); });
});
const root = `/private/tmp/atman-video-${target}`;
const live = target.endsWith('-live');
const adminOrigin = live ? 'https://admin.itdot.co.kr' : 'http://localhost:3002';
const workerOrigin = live ? 'https://itdot.co.kr' : 'http://localhost:3003';

async function authStorageKey() {
  const env = await fs.readFile('apps/admin-web/.env.local', 'utf8');
  const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
  if (!match) throw new Error('Supabase 브라우저 설정을 찾지 못했습니다.');
  return `sb-${new URL(match[1].trim()).hostname.split('.')[0]}-auth-token`;
}

// 운영(-live)은 방문자와 같은 공개 시연 입구(admin /api/demo-login)로 들어간다 — 서비스 키를 쓰지 않는다.
// 이 경로는 로그인만 하고 시연 데이터를 초기화하지 않는다(2026-11-05부터 공개 시연 계정의 '시연 초기화'는 서버가 거부, 데이터는 매일 08:30 자동 재생성).
async function adminDemoCredentials(email) {
  if (live) {
    const response = await fetch(`${adminOrigin}/api/demo-login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.accessToken || !data.refreshToken) throw new Error(`관리자 시연 로그인 실패(${response.status}): ${data.error ?? ''}`);
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  }
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
let chromeProcess = null;
function stopChrome() { try { if (chromeProcess?.pid) process.kill(chromeProcess.pid); } catch { /* 이미 종료 */ } }
async function startChrome() {
  const child = spawn(chrome, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${root}/profile`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  chromeProcess = child;
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
  // 운영 화면은 데이터를 비동기로 불러온다 — 고정 대기 대신 화면에 기대한 내용이 뜰 때까지 기다린다(못 찾으면 경고만)
  async function waitFor(expression, timeoutMs = 12000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const result = await cdp.send('Runtime.evaluate', { expression: `Boolean(${expression})`, returnByValue: true }).catch(() => null);
      if (result?.result?.value) return true;
      await sleep(300);
    }
    console.warn('WAIT_TIMEOUT', expression.slice(0, 120));
    return false;
  }
  const hasText = (text) => `document.body?.innerText?.includes(${JSON.stringify(text)})`;
  const lacksText = (text) => `!document.body?.innerText?.includes(${JSON.stringify(text)})`;
  if (target === 'public' || target === 'public-live') {
    await go(`${workerOrigin}/`); await shot('01-worker-entry');
    await go(`${workerOrigin}/demo`); await shot('02-worker-demo');
    await go(`${workerOrigin}/gig/demo`); await shot('03-gig-demo');
    await go(`${workerOrigin}/worker-intro`); await shot('04-worker-intro');
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#demo')?.scrollIntoView(); true` });
    await sleep(500); await shot('05-worker-intro-conversion');
    await go(`${workerOrigin}/intro`);
    await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#admin-demo')?.scrollIntoView(); true` });
    await sleep(500); await shot('06-admin-intro-conversion');
    await go(`${adminOrigin}/login`); await shot('07-admin-login');
    await go(`${adminOrigin}/login?install=1`); await shot('08-admin-install');
  } else if (target === 'worker-medical') {
    await go(`${workerOrigin}/`);
    const loginResponse = await fetch('https://itdot.co.kr/api/demo-login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'worker-demo-1@demo.atman.co.kr' }),
    });
    const login = await loginResponse.json();
    if (!login.accessToken || !login.refreshToken) throw new Error('의료 시연 워커 세션을 가져오지 못했습니다.');
    const payload = JSON.parse(Buffer.from(login.accessToken.split('.')[1], 'base64url').toString());
    const session = { access_token: login.accessToken, refresh_token: login.refreshToken, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { id: payload.sub, email: 'worker-demo-1@demo.atman.co.kr', aud: 'authenticated', role: 'authenticated' } };
    const key = await authStorageKey();
    await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))}); true` });
    await go(`${workerOrigin}/home`); await sleep(2500); await shot('01-medical-home');
    await go(`${workerOrigin}/applications`); await sleep(1600); await shot('02-medical-work');
    await go(`${workerOrigin}/notifications`); await sleep(1200); await shot('03-medical-notices');
    await go(`${workerOrigin}/settings`); await sleep(1200); await shot('04-medical-settings');
  } else if (target === 'worker-gig' || target === 'worker-gig-live') {
    await go(`${workerOrigin}/gig/demo`);
    const loginResponse = await fetch('https://itdot.co.kr/api/demo-login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'GIG2026' }),
    });
    const login = await loginResponse.json();
    if (!login.accessToken || !login.refreshToken || !login.gigInviteToken) throw new Error('긱 시연 워커 세션을 가져오지 못했습니다.');
    const payload = JSON.parse(Buffer.from(login.accessToken.split('.')[1], 'base64url').toString());
    const session = { access_token: login.accessToken, refresh_token: login.refreshToken, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { id: payload.sub, email: 'worker-gig-demo@demo.atman.co.kr', aud: 'authenticated', role: 'authenticated' } };
    const key = await authStorageKey();
    await cdp.send('Runtime.evaluate', { expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))}); localStorage.setItem('atman_demo_panel', '1'); true` });
    if (login.gigResume) {
      // '진행 중인 시연'으로 판정돼 초기화를 건너뛰었다(이미 수락됨) — 초대 화면은 '이미 사용된 초대'로 찍히므로 덮어쓰지 않는다.
      // 주의(2026-11-05 확인): 15분 크론 refresh_demo_worker_readiness 가 오늘 근태가 없는 고정 근무자 행의 updated_at 을 계속 갱신해
      // '최근 1시간'이 영원히 참이 되고, 08:30 정리(cleanup_gig_demo_facility)도 고정 행의 연결은 풀지 않는다 → 한 번 수락되면 계속 이 상태.
      // 풀려면 사장님 시연(login?demo=gigworker) 근태에서 '사장님이 직접 처리' 출근→퇴근을 남기고 1시간 뒤 다시 실행한다(docs/demo_video_script_80s.md).
      console.warn('GIG_RESUME: 이미 수락된 시연이라 00-gig-invite 는 찍지 않고 나머지 화면만 찍어요.');
    } else {
      await go(`${workerOrigin}/gig/join?token=${encodeURIComponent(login.gigInviteToken)}`);
      // 미리보기(근무 조건) RPC 가 끝나 '초대 수락하고 연결' 버튼이 나올 때까지 기다린 뒤 찍는다
      let ready = false;
      for (let attempt = 0; attempt < 20 && !ready; attempt += 1) {
        const probe = await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('초대 수락'))`, returnByValue: true });
        ready = Boolean(probe?.result?.value);
        if (!ready) await sleep(500);
      }
      if (!ready) throw new Error('초대 확인 화면에 수락 버튼이 없어요(이미 수락됐거나 초대 오류).');
      await sleep(600); await shot('00-gig-invite'); // 초대 확인 화면(수락 전)
      await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('초대 수락'))?.click(); true` });
      await sleep(4000);
    }
    // 수락 직후 첫 /gig 에는 '연결됐어요' 안내가 한 번 뜬다(위에서 4초 기다리는 동안 소비됨) — 다시 열어 오늘 근무·출근하기를 찍는다
    await go(`${workerOrigin}/gig`); await waitFor(`${hasText('출근하기')} || ${hasText('근무 중')} || ${hasText('근무 완료')}`); await sleep(800); await shot('01-gig-home');
    // 워크룸: 입력칸 아래 개인정보 줄('나와 사장님만 볼 수 있어요')이 시연 띠에 가려서 조금(36px) 내려 찍는다 — 맨 아래까지 내리면 제목이 잘린다
    await go(`${workerOrigin}/gig/workroom`); await waitFor(`document.querySelector('textarea[aria-label="대화 메시지"]') && !document.querySelector('textarea[aria-label="대화 메시지"]').disabled`);
    await cdp.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 36); true' }); await sleep(900); await shot('02-gig-workroom');
    await go(`${workerOrigin}/gig/settlement`); await waitFor(`${hasText('지급')} && ${lacksText('불러오고 있어요')} && ${lacksText('확인하고 있어요')}`); await sleep(1200); await shot('03-gig-settlement');
    await go(`${workerOrigin}/gig/notifications`); await sleep(1500); await shot('04-gig-notifications');
    await go(`${workerOrigin}/gig/settings`); await waitFor(hasText('출근 알림')); await sleep(900); await shot('05-gig-settings');
  } else if (target === 'worker' || target === 'worker-live') {
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
    // 근무 찾기: 맨 위는 7일 근무표라 카드가 안 보인다 — '날짜별 근무' 목록까지 내려 찍고, 첫 카드의 '지원하기'로
    // 지원 시트(시급·휴게 뺀 예상 지급액·사업장 공표 정보)를 열어 찍는다. 시트 안의 최종 '지원하기'는 누르지 않는다(쓰기 없음)
    await go(`${workerOrigin}/shifts`); await waitFor(hasText('지원하기')); await sleep(600);
    await cdp.send('Runtime.evaluate', { expression: `(() => { const h = Array.from(document.querySelectorAll('h2')).find((node) => /날짜별 근무|가까운 근무|시급이 높은 근무/.test(node.textContent ?? '')); if (!h) return false; h.scrollIntoView({ block: 'start' }); window.scrollBy(0, -24); return true; })()` });
    await sleep(800); await shot('05-shifts');
    await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === '지원하기')?.click(); true` });
    await waitFor(`${hasText('예상 지급액')} && ${lacksText('사업장 정보 확인 중')}`); await sleep(1200); await shot('05-apply-sheet');
    await go(`${workerOrigin}/applications`); await shot('06-applications');
    // Chat links only render on accepted/completed cards, which live under the
    // "확정 근무" tab — the default "진행 중" tab shows pending applications without them.
    await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim().startsWith('확정 근무'))?.click(); true` });
    await sleep(1200);
    // The applications list loads asynchronously on production; poll for the
    // chat link instead of assuming it is present after the fixed navigation wait.
    let hrefs = [];
    for (let attempt = 0; attempt < 16 && hrefs.length === 0; attempt += 1) {
      const chatHrefs = await cdp.send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('a[href^="/chat/"]')).map((node) => node.getAttribute('href')).filter(Boolean)`, returnByValue: true });
      hrefs = Array.isArray(chatHrefs?.result?.value) ? chatHrefs.result.value : [];
      if (hrefs.length === 0) await sleep(500);
    }
    // 확정 근무가 여러 건이면 채팅방도 여러 개다. 대화가 비어 있는 방(새로 확정된 근무)이
    // 먼저 올 수 있으므로, 사업장↔워커 말풍선이 가장 많은 방을 골라 찍는다.
    // The seeded showcase already holds a facility → worker exchange, which is
    // the cleanest chat frame. Do not send quick replies here: every capture run
    // would append more worker bubbles and the scene turns into a monologue.
    let best = null;
    for (const href of hrefs.slice(0, 6)) {
      await go(`${workerOrigin}${href}`); await sleep(700);
      const count = await cdp.send('Runtime.evaluate', { expression: `document.querySelectorAll('.self-end, .self-start').length`, returnByValue: true });
      const bubbles = Number(count?.result?.value ?? 0);
      if (!best || bubbles > best.bubbles) best = { href, bubbles };
      if (bubbles >= 3) break;
    }
    if (best) {
      await go(`${workerOrigin}${best.href}`);
      await sleep(700); await shot('07-chat');
    }
    await go(`${workerOrigin}/workplace`); await shot('08-workplace');
    await go(`${workerOrigin}/store/credits`); await shot('09-payments');
    // 알림 목록은 영상에 쓰지 않는다(2026-11-05: 같은 날 병원 QA 가 남긴 'QA-1105 … 테스트' 알림이 맨 위에 보였다). 확인용으로만 찍는다
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
        const facility = await fetch('/api/set-facility', { method: 'POST', headers, body: ${JSON.stringify(target.startsWith('admin-gig') ? JSON.stringify({ demoKind: 'gigworker' }) : '{}')} });
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
    // 0. 사업장 등록(검색 → 지도 핀) 장면은 더 이상 찍지 않는다 (2026-10-01).
    // app/setup/layout.tsx 가 사업장을 이미 소유한 관리자를 홈으로 돌려보내는데, 시연 관리자
    // (sales-demo-1~3)는 모두 사업장을 가지고 있어 /setup/claim-facility 가 열리지 않는다.
    // 사업장 없는 계정이 생기면 이 자리에서 '병원·약국 인력 모집' 선택 → 사업장명 검색(aria-label
    // "사업장명 검색") → '바로 등록 가능' 결과 클릭 순서로 00-facility-search / 00-facility-register 를 찍으면 된다.
    // 상단 사업장 헤더가 고정이라, 스크롤로 맞출 때는 그 높이(약 80px)만큼 내려 둔다
    const scrollToSelector = async (selector, offset = 84) => {
      const found = await cdp.send('Runtime.evaluate', { expression: `(() => { const el = ${selector}; if (!el) return false; el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -${offset}); return true; })()`, returnByValue: true });
      await sleep(800);
      if (!found?.result?.value) console.warn('SCROLL_TARGET_MISSING', selector.slice(0, 100));
      return Boolean(found?.result?.value);
    };
    await go(`${adminOrigin}/shifts/new`); await waitFor(hasText('최근 공고 조건')); await shot('02-shift-create');
    // 지원 현황: 2026-11 부터 맨 위에 '대타 요청'(승인 필요)이 먼저 나온다 — 대타 장면(맨 위)과 지원자 장면(필터부터)을 따로 찍는다
    await go(`${adminOrigin}/applications`); await waitFor(hasText('명 지원')); await shot('03-cover');
    await scrollToSelector(`document.querySelector('nav[aria-label="지원자 필터"]')`); await shot('03-applications');
    await go(`${adminOrigin}/chats`); await waitFor(hasText('대화 목록')); await shot('04-chats');
    // 새 메시지가 있는 방(근무자 말풍선이 있는 방)을 열어 대화 화면도 찍는다. 보내지는 않는다
    const roomHref = await cdp.send('Runtime.evaluate', { expression: `(() => { const links = Array.from(document.querySelectorAll('a[href^="/chats/"]')); const pick = links.find((a) => a.innerText.includes('새 메시지')) ?? links.find((a) => !/채용이 확정|근무$/.test(a.innerText.trim())); return pick?.getAttribute('href') ?? null; })()`, returnByValue: true });
    if (roomHref?.result?.value) { await go(`${adminOrigin}${roomHref.result.value}`); await sleep(1200); await shot('04-chat-room'); }
    // 근태: 탭 없이 한 화면(확인 필요 카드 → 숫자 칸 → 오늘 근무자, 2026-11-10) — 맨 위부터 찍는다.
    // 아래로 내리면 시드 이상값(박서윤 출근 00:09)이 보여 스크롤하지 않는다(2026-11-05)
    await go(`${adminOrigin}/timesheet`); await waitFor(hasText('오늘 근무자'));
    await sleep(1200); await shot('05-timesheet');
    await go(`${adminOrigin}/payroll`); await sleep(1200); await shot('07-payroll');
    await go(`${adminOrigin}/attendance-qr`); await waitFor(hasText('인증 방법')); await shot('06-attendance-auth');
    await scrollToSelector(`Array.from(document.querySelectorAll('h2,h3')).find((node) => node.textContent?.trim() === '인증 방법')`, 40); await shot('06-attendance-methods');
    await go(`${adminOrigin}/notifications`); await shot('06-notifications');
  }
  cdp.close(); stopChrome(); console.log(root);
}
main().catch((error) => { console.error(error); stopChrome(); process.exit(1); });
