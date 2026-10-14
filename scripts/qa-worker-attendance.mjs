// Production-build browser regression with synthetic auth and intercepted DB calls.
// No real login, attendance, notification, or demo reset is sent to Supabase.
// Usage: node scripts/qa-worker-attendance.mjs /absolute/path/to/playwright-core
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright-core');
const { loadEnvConfig } = require('../apps/worker-web/node_modules/@next/env');
loadEnvConfig(path.resolve('apps/worker-web'), false, { info() {}, error() {} });
const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const origin = 'http://127.0.0.1:3003';
const directory = await mkdtemp(path.join(tmpdir(), 'itdot-attendance-qa-'));
const user = { id: '10000000-0000-4000-8000-000000000001', email: 'qa@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' })}.qa-only`;
const session = { access_token: token, refresh_token: 'qa-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const staff = { id: '20000000-0000-4000-8000-000000000001', name: '검증 워커', worker_kind: 'gig', status: 'active', default_start_time: '09:00:00', default_end_time: '18:00:00', work_weekdays: [1, 2, 3, 4, 5, 6, 7], gig_assignments: [], facilities: { id: '30000000-0000-4000-8000-000000000001', name: '검증 근무지' } };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const passed = [];
try {
  for (const width of [360, 390]) {
    let brokenLoad = true;
    let attendanceMode = 'time_error';
    let calls = 0;
    let noticesEnabled = false, brokenNotices = true, rejectRead = true;
    const notices = [
      { id: 'notice-1', event_type: 'workroom.message', title: '긴 알림 제목도 중요한 내용이 잘리지 않고 확인할 수 있어야 해요', body: '오후 근무 일정이 변경됐어요. 내용을 확인해 주세요.', data: { staffId: staff.id }, created_at: new Date().toISOString(), read_at: null },
      { id: 'notice-2', event_type: 'workroom.check', title: '사장님이 출석 확인을 요청했어요', body: '근무지 대화에서 확인해 주세요.', data: { url: `/workroom?facility=${staff.facilities.id}`, staffId: staff.id }, created_at: new Date().toISOString(), read_at: null },
    ];
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(({ key, session }) => { localStorage.setItem(key, JSON.stringify(session)); }, { key: `sb-${backend.hostname.split('.')[0]}-auth-token`, session });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.origin !== backend.origin) return json({});
      if (url.pathname === '/auth/v1/user') return json(user);
      if (url.pathname.endsWith('/facility_staff')) {
        if (brokenLoad && url.searchParams.get('select')?.includes('gig_assignments')) return json({ message: 'QA simulated outage', code: 'QA' }, 503);
        return json([staff]);
      }
      if (url.pathname.endsWith('/workers')) return json({ role: 'other' });
      if (url.pathname.endsWith('/facility_attendance_settings')) return json([{ facility_id: staff.facilities.id, authentication_mode: 'qr' }]);
      if (url.pathname.endsWith('/get_my_notifications') && noticesEnabled) return brokenNotices ? json({ message: 'QA load failure' }, 503) : json(notices);
      if (url.pathname.endsWith('/mark_my_notification_read')) return rejectRead ? json({ message: 'QA read failure' }, 503) : json(true);
      if (url.pathname.endsWith('/record_unified_attendance')) {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (attendanceMode === 'network') return route.abort('failed');
        if (attendanceMode === 'time_error') return json({ ok: false, reason: 'TIME_NOT_ALLOWED', message: '현재는 출퇴근 가능 시간이 아니에요.' });
        return json({ ok: true, action: 'check_in', status: 'approved', checkInAt: `${today}T09:03:00+09:00`, lateMinutes: 3, method: 'QR' });
      }
      // All remaining remote endpoints stay mocked (including prefetches).
      return json([]);
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/gig`);
    await page.getByText('근무 정보를 불러오지 못했어요', { exact: true }).waitFor();
    assert.equal(await page.getByText('아직 연결된 근무가 없어요', { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(directory, `${width}-load-error.png`), fullPage: true });
    brokenLoad = false;
    await page.getByRole('button', { name: '다시 불러오기' }).click();
    const checkIn = page.getByRole('button', { name: '길게 눌러 출근 기록', exact: true });
    await checkIn.waitFor();
    for (const control of [page.getByRole('link', { name: '앱 설정', exact: true }), page.getByRole('link', { name: /^근무 알림/ }), ...await page.getByRole('tab').all()]) {
      const box = await control.boundingBox();
      assert.ok(box && box.height >= 44 && box.width >= 44, 'primary navigation touch target is at least 44px');
    }
    const failureDispatch = page.waitForRequest(request => new URL(request.url()).pathname === '/api/attendance/nudge' && request.method() === 'POST');
    await checkIn.press('Enter');
    await failureDispatch;
    const help = page.getByRole('link', { name: '사장님께 확인 요청', exact: true });
    await help.waitFor();
    assert.equal(await help.getAttribute('href'), `/gig/workroom?facility=${staff.facilities.id}`);
    assert.equal(await page.getByRole('button', { name: '동적 QR로 인증', exact: true }).count(), 0);
    assert.equal(calls, 1);
    await page.screenshot({ path: path.join(directory, `${width}-time-error.png`), fullPage: true });
    attendanceMode = 'network';
    await page.getByRole('button', { name: '다시 확인', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="길게 눌러 출근 기록"]')?.disabled);
    assert.equal(calls, 2);
    attendanceMode = 'success';
    // Two assistive-tech clicks in one frame must not create two RPC requests.
    await checkIn.evaluate((button) => { button.click(); button.click(); });
    await page.getByRole('button', { name: '길게 눌러 퇴근 기록', exact: true }).waitFor();
    const savedNotice = page.getByText('출근 기록을 저장했어요. 지각 3분으로 기록됐어요.', { exact: true });
    await savedNotice.waitFor();
    const noticeBox = await savedNotice.boundingBox();
    assert.ok(noticeBox && noticeBox.y >= 0 && noticeBox.y + noticeBox.height < 788);
    assert.equal(calls, 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(directory, `${width}-success.png`), fullPage: true });
    passed.push({ width, checks: ['44px navigation targets', 'load failure/retry', 'time error/help', 'no misleading QR', 'network recovery', 'single-flight', 'persistent success', 'no horizontal overflow', 'no uncaught errors'] });
    noticesEnabled = true;
    await page.goto(`${origin}/gig/notifications`);
    await page.getByText('알림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', { exact: true }).waitFor();
    brokenNotices = false;
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    const firstNotice = page.getByRole('button').filter({ hasText: notices[0].title });
    await firstNotice.click();
    await page.getByText('읽음 표시를 저장하지 못했어요. 알림 내용은 계속 확인할 수 있어요.', { exact: true }).waitFor();
    assert.ok((await firstNotice.getAttribute('class')).includes('bg-primary/5'));
    rejectRead = false;
    await firstNotice.click();
    await page.waitForFunction((title) => [...document.querySelectorAll('button')].some(button => button.textContent.includes(title) && button.classList.contains('bg-white')), notices[0].title);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(directory, `${width}-notifications.png`), fullPage: true });
    await page.route(`${origin}/gig/workroom?*`, route => route.fulfill({ contentType: 'text/html', body: '<title>QA notification destination</title>' }));
    await page.getByRole('button').filter({ hasText: notices[1].title }).click();
    await page.waitForURL(`${origin}/gig/workroom?facility=${staff.facilities.id}`);
    assert.deepEqual(errors, []);
    passed.push({ width, checks: ['notification load retry', 'read failure stays unread', 'read retry', 'gig destination mapping', 'notification layout'] });
    await context.close();
  }
  console.log(JSON.stringify({ passed, screenshots: directory, realBackendWrites: 0 }, null, 2));
} finally { await browser.close(); }
