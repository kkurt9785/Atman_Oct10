// UX 워크스루 QA — 브랜치 코드를 로컬(3002/3003)에 띄운 상태에서 데모 계정으로 관리자·워커 앱 핵심 흐름을 밟는다.
// 화면마다 스크린샷 + 지표(가로 넘침, 페이지 길이, 탭 수, 작은 터치 타깃, 화면 밖 텍스트, 에러 문구)를 남긴다.
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const target = process.argv[2] ?? 'worker-gig';
const port = 9340 + ['worker-gig','worker-medical','admin-gig','admin-hospital'].indexOf(target);
const root = `/private/tmp/atman-ux/${target}`;
const adminOrigin = 'http://localhost:3002';
const workerOrigin = 'http://localhost:3003';
async function adminDemoCredentials(email) {
  const env = await fs.readFile('apps/admin-web/.env.local', 'utf8');
  const value = (name) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  const url = value('SUPABASE_URL') ?? value('NEXT_PUBLIC_SUPABASE_URL'); const anon = value('NEXT_PUBLIC_SUPABASE_ANON_KEY'); const serviceRole = value('SUPABASE_SERVICE_ROLE_KEY');
  const link = await fetch(`${url}/auth/v1/admin/generate_link`, { method: 'POST', headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) }).then((r) => r.json());
  const data = await fetch(`${url}/auth/v1/verify`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: link.verification_type ?? 'magiclink', token_hash: link.hashed_token }) }).then((r) => r.json());
  if (!data.access_token) throw new Error('관리자 데모 세션 실패 ' + JSON.stringify(data).slice(0, 200));
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
async function authStorageKey() {
  const env = await fs.readFile('apps/admin-web/.env.local', 'utf8');
  const match = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
  return `sb-${new URL(match[1].trim()).hostname.split('.')[0]}-auth-token`;
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
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const cdp = await connect(await startChrome());
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const report = [];
  let n = 0;
  async function evalJson(expression) { const r = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((() => { ${expression} })())`, returnByValue: true, awaitPromise: true }); return JSON.parse(r?.result?.value ?? 'null'); }
  async function settle(maxMs = 9000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const busy = await evalJson(`return document.readyState !== 'complete' || /불러오고|확인하고 있어요|여는 중|준비 중|처리 중/.test(document.body?.innerText ?? '')`);
      if (!busy) break; await sleep(400);
    }
    await sleep(600);
  }
  async function go(url) { await cdp.send('Page.navigate', { url }); await settle(); }
  async function click(text) {
    const ok = await evalJson(`const el = Array.from(document.querySelectorAll('button,a,summary,label')).find((node) => (node.textContent ?? '').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true;`);
    if (!ok) report.push({ step: `click:${text}`, error: 'not found' });
    await settle(); return ok;
  }
  async function fill(selector, value) {
    await evalJson(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
  }
  async function shot(name, note = '') {
    await evalJson(`document.querySelector('button[aria-label="설치 안내 닫기"]')?.click(); return true`);
    await sleep(250);
    const metrics = await evalJson(`
      const vw = window.innerWidth; const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const navs = Array.from(document.querySelectorAll('nav')).filter(visible).map((nav) => ({ label: nav.getAttribute('aria-label'), tabs: Array.from(nav.querySelectorAll('a')).map((a) => (a.textContent ?? '').trim()) }));
      const targets = Array.from(document.querySelectorAll('button,a')).filter(visible).filter((el) => (el.textContent ?? '').trim());
      const small = targets.filter((el) => el.getBoundingClientRect().height < 36).map((el) => (el.textContent ?? '').trim().slice(0, 24));
      const offscreen = Array.from(document.querySelectorAll('body *')).filter(visible).filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 2 && (el.textContent ?? '').trim(); }).map((el) => (el.textContent ?? '').trim().slice(0, 30)).slice(0, 5);
      const errors = (document.body.innerText.match(/[^\\n]*(오류|실패|못했어요|찾을 수 없|잘못)[^\\n]*/g) ?? []).slice(0, 4);
      return { url: location.pathname + location.search, title: document.title, hOverflow: document.documentElement.scrollWidth > vw, pageHeight: document.documentElement.scrollHeight, viewport: window.innerHeight, navs, smallTargets: small.slice(0, 6), smallCount: small.length, offscreen, errors, h1: Array.from(document.querySelectorAll('h1')).map((h) => h.textContent?.trim()).slice(0, 2) };
    `);
    n += 1; const file = `${String(n).padStart(2, '0')}-${name}`;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(`${root}/${file}.png`, Buffer.from(data, 'base64'));
    if (metrics && metrics.pageHeight > metrics.viewport * 1.15) {
      await evalJson(`window.scrollTo(0, document.documentElement.scrollHeight); return true`); await sleep(400);
      const bottom = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await fs.writeFile(`${root}/${file}-bottom.png`, Buffer.from(bottom.data, 'base64'));
      await evalJson(`window.scrollTo(0, 0); return true`);
    }
    report.push({ file, note, ...metrics });
  }
  async function setSession(email, login) {
    if (!login?.accessToken) throw new Error(`demo login failed: ${JSON.stringify(login)}`);
    const payload = JSON.parse(Buffer.from(login.accessToken.split('.')[1], 'base64url').toString());
    const session = { access_token: login.accessToken, refresh_token: login.refreshToken, token_type: 'bearer', expires_in: 3600, expires_at: payload.exp, user: { id: payload.sub, email, aud: 'authenticated', role: 'authenticated' } };
    await evalJson(`localStorage.setItem(${JSON.stringify(await authStorageKey())}, ${JSON.stringify(JSON.stringify(session))}); return true`);
  }
  // 세션 토큰은 운영 API 에서 받는다(같은 Supabase 프로젝트). 화면은 로컬 브랜치 코드.
  const demoLogin = (body) => fetch('https://itdot.co.kr/api/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  if (target === 'worker-gig') {
    await go(`${workerOrigin}/`); await shot('entry', '첫 화면(비로그인)');
    await go(`${workerOrigin}/gig`); await shot('gig-landing', '긱 랜딩(비로그인)');
    const login = await demoLogin({ code: 'GIG2026' });
    await setSession('worker-gig-demo@demo.atman.co.kr', login);
    await evalJson(`localStorage.setItem('atman_gigworker_mode','1'); return true`);
    await go(`${workerOrigin}/gig/join?token=${encodeURIComponent(login.gigInviteToken)}`); await shot('join-preview', '초대 확인(계좌 전달 안내 보여야 함)');
    await click('잇기'); await sleep(1500); await shot('join-success', '수락 후(이어졌어요 + 계좌 전달 결과)');
    await go(`${workerOrigin}/gig`); await shot('gig-home', '긱 홈(🔔 배지·오늘 근무·닿기)');
    await go(`${workerOrigin}/gig/workroom`); await shot('gig-workroom');
    await go(`${workerOrigin}/gig/settlement`); await shot('gig-settlement', '계좌 전달됨 표시 기대');
    await go(`${workerOrigin}/gig/notifications`); await shot('gig-notifications');
    await go(`${workerOrigin}/gig/settings`); await shot('gig-settings', '직군 등록 CTA 기대');
    await go(`${workerOrigin}/home`); await shot('gig-visits-home', '긱 전용이 /home → /gig 로 튕겨야 함');
  } else if (target === 'worker-medical') {
    const login = await demoLogin({ email: 'worker-demo-1@demo.atman.co.kr' });
    await go(`${workerOrigin}/`); await setSession('worker-demo-1@demo.atman.co.kr', login);
    await evalJson(`localStorage.removeItem('atman_gigworker_mode'); return true`);
    await go(`${workerOrigin}/`); await shot('root-redirect', '루트 → /home 리다이렉트');
    await go(`${workerOrigin}/home`); await shot('home');
    await go(`${workerOrigin}/shifts`); await shot('shifts');
    await go(`${workerOrigin}/applications`); await shot('applications');
    await go(`${workerOrigin}/workplace`); await shot('workplace');
    await go(`${workerOrigin}/workroom`); await shot('workroom', '비공개 대화 토글 기대');
    await go(`${workerOrigin}/notifications`); await shot('notifications');
    await go(`${workerOrigin}/settings`); await shot('settings');
    await go(`${workerOrigin}/gig`); await shot('medical-visits-gig', '의료 전용이 /gig → /home 이동 안내');
  } else {
    const kind = target === 'admin-gig' ? 'gigworker' : 'hospital';
    await go(`${adminOrigin}/login`); await shot('login', '관리자 로그인 화면');
    const credentials = await adminDemoCredentials('sales-demo-1@demo.atman.co.kr');
    await setSession('sales-demo-1@demo.atman.co.kr', credentials);
    const ok = await evalJson(`return (async () => { const headers = { Authorization: 'Bearer ' + ${JSON.stringify(credentials.accessToken)}, 'content-type': 'application/json' }; const s = await fetch('/api/admin-session', { method: 'POST', headers }); const f = await fetch('/api/set-facility', { method: 'POST', headers, body: ${JSON.stringify(kind === 'gigworker' ? JSON.stringify({ demoKind: 'gigworker' }) : '{}')} }); return s.ok && f.ok; })()`);
    if (!ok) throw new Error('관리자 세션/사업장 설정 실패');
    if (target === 'admin-gig') {
      await go(`${adminOrigin}/`);
      // 사업장 전환기(헤더 셀렉트)에서 긱 데모 근무지를 고른다 — 실제 사장님이 두 사업장을 오가는 동작과 같다
      await evalJson(`const sel = document.querySelector('header select'); if (!sel) return false; const opt = Array.from(sel.options).find((o) => o.textContent.includes('팝업')); if (!opt) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value); sel.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
      await sleep(3500); await settle(); await go(`${adminOrigin}/`); await shot('gig-home', '근무 건 카드 + 보드');
      await go(`${adminOrigin}/gig-work/new`); await shot('gig-work-new');
      await fill('input[name="title"]', '[UX] 주말 팝업 행사');
      await click('기간 · 반복 근무');
      const t = new Date(Date.now() + 9 * 3600e3); const d = (x) => new Date(t.getTime() + x * 86400e3).toISOString().slice(0, 10);
      await fill('input[name="starts_on"]', d(0)); await fill('input[name="ends_on"]', d(3));
      await fill('input[name="pay_rate"]', '15000'); await fill('input[name="headcount"]', '3');
      await shot('gig-work-new-filled');
      await click('근무 만들기 → 근무자 잇기'); await sleep(2500); await settle();
      await shot('gig-work-detail', '생성 직후 상세(참여자 0)');
      await fill('input[name="name"]', '[UX] 새 근무자');
      await click('등록하고 잇기 링크 만들기'); await sleep(2500); await settle();
      await shot('gig-work-invited', '새 사람 잇기 후(링크 복사 버튼)');
      await go(`${adminOrigin}/`); await shot('gig-home-after', '홈에 근무 건 카드 1/3');
      await go(`${adminOrigin}/staff?view=contract&entry=gigworker`); await shot('gig-staff');
      await go(`${adminOrigin}/workroom`); await shot('gig-workroom');
      await go(`${adminOrigin}/timesheet`); await shot('gig-timesheet');
      await go(`${adminOrigin}/gig-pay`); await shot('gig-pay');
      await go(`${adminOrigin}/more`); await shot('gig-more');
      // 정리: 만든 근무 건 취소
      const detail = report.find((r) => r.note?.includes('생성 직후'))?.url;
      if (detail) { await go(`${adminOrigin}${detail}`); await evalJson(`window.confirm = () => true; return true`); await click('이 근무 취소'); await sleep(1500); await shot('gig-work-cancelled', '취소 후'); }
    } else {
      await go(`${adminOrigin}/`); await shot('hospital-home');
      await go(`${adminOrigin}/staff`); await shot('hospital-staff');
      await go(`${adminOrigin}/staff?view=contract&entry=gigworker`); await shot('hospital-staff-gig-entry', '외부 단기근로자 초대 폼');
      await go(`${adminOrigin}/timesheet`); await shot('hospital-timesheet');
      await go(`${adminOrigin}/workroom`); await shot('hospital-workroom', '근무자 칩 + 비공개 대화');
      await go(`${adminOrigin}/gig-pay`); await shot('hospital-gig-pay', '병원에서도 열림(긱 근무자 없으면 안내)');
      await go(`${adminOrigin}/more`); await shot('hospital-more');
    }
  }
  if (target === 'admin-gig') {
    // 워크스루가 만든 [UX] 근무자·근무 건은 운영 데모 데이터에 남기지 않는다
    const env = await fs.readFile('apps/admin-web/.env.local', 'utf8');
    const value = (name) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
    const base = value('SUPABASE_URL') ?? value('NEXT_PUBLIC_SUPABASE_URL'); const key = value('SUPABASE_SERVICE_ROLE_KEY');
    const h = { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' };
    for (const path of ['facility_workroom_messages?body=like.*%5BUX%5D*', 'facility_staff?name=like.%5BUX%5D*', 'gig_projects?title=like.%5BUX%5D*', 'notification_outbox?body=like.*%5BUX%5D*']) {
      await fetch(`${base}/rest/v1/${path}`, { method: 'DELETE', headers: h }).catch(() => undefined);
    }
  }
  await fs.writeFile(`${root}/report.json`, JSON.stringify(report, null, 2));
  for (const r of report) if (r.file) console.log(`${r.file}  ${r.url}  h=${r.pageHeight}${r.hOverflow ? '  ⚠가로넘침' : ''}${r.offscreen?.length ? '  ⚠화면밖:' + r.offscreen.join('|') : ''}${r.smallCount ? '  작은타깃' + r.smallCount : ''}${r.errors?.length ? '  ⚠' + r.errors.join(' / ') : ''}  ${r.navs?.map((v) => v.tabs.join('·')).join(' || ') ?? ''}`); else console.log('!!', JSON.stringify(r));
  cdp.close(); process.exit(0);
}
main().catch((error) => { console.error(error); process.exit(1); });
