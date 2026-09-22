const workerOrigin = process.env.QA_WORKER_ORIGIN ?? 'https://itdot.co.kr';
const adminOrigin = process.env.QA_ADMIN_ORIGIN ?? 'https://admin.itdot.co.kr';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('Supabase QA 환경 변수가 필요합니다.');

const startedAt = new Date().toISOString();
let workerToken = '';
let inviteToken = '';
let facilityId = '';

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${response.status} ${url}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

function restHeaders(token, service = false, extra = {}) {
  const key = service ? serviceKey : anonKey;
  return { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json', ...extra };
}

async function rpc(name, body, token) {
  return jsonFetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: restHeaders(token), body: JSON.stringify(body ?? {}),
  });
}

function expect(condition, label) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}

try {
  const workerLogin = await jsonFetch(`${workerOrigin}/api/demo-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'GIG2026' }),
  });
  workerToken = workerLogin.accessToken;
  inviteToken = workerLogin.gigInviteToken;
  expect(Boolean(workerToken && inviteToken), '긱워커 데모 로그인과 일회용 초대 발급');

  await jsonFetch(`${supabaseUrl}/rest/v1/facility_staff_invites?token=eq.${encodeURIComponent(inviteToken)}`, {
    method: 'PATCH', headers: restHeaders('', true, { Prefer: 'return=minimal' }), body: JSON.stringify({ phone_normalized: null }),
  });
  const preview = await rpc('get_facility_staff_invite_preview', { p_token: inviteToken }, '');
  expect(preview?.ok === true && preview?.phoneRequired === false && !preview?.phoneLast4, '전화번호 없는 초대 미리보기');

  await rpc('claim_facility_staff_invite', { p_token: inviteToken }, workerToken);
  const workerRooms = await rpc('get_my_workrooms', {}, workerToken);
  const room = workerRooms.find((item) => item.registration_source === 'gigworker_trial');
  expect(Boolean(room?.facility_id), '워커 계정과 사업장 워크룸 자동 연결');
  facilityId = room.facility_id;

  const workerBody = `[QA] 워커 메시지 ${Date.now()}`;
  await rpc('send_facility_workroom_message', { p_facility_id: facilityId, p_body: workerBody, p_announcement: false }, workerToken);

  const adminLogin = await jsonFetch(`${adminOrigin}/api/demo-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sales-demo-1@demo.atman.co.kr' }),
  });
  const adminToken = adminLogin.accessToken;
  const adminRooms = await rpc('get_my_workrooms', {}, adminToken);
  expect(adminRooms.some((item) => item.facility_id === facilityId), '관리자에게 같은 워크룸 노출');

  const adminBody = `[QA] 관리자 공지 ${Date.now()}`;
  await rpc('send_facility_workroom_message', { p_facility_id: facilityId, p_body: adminBody, p_announcement: true }, adminToken);
  const visible = await jsonFetch(`${supabaseUrl}/rest/v1/facility_workroom_messages?select=sender_type,message_type,body&facility_id=eq.${facilityId}&created_at=gte.${encodeURIComponent(startedAt)}&order=created_at.asc`, {
    headers: restHeaders(workerToken),
  });
  expect(visible.some((item) => item.body === workerBody && item.sender_type === 'worker'), '워커 메시지 저장·조회');
  expect(visible.some((item) => item.body === adminBody && item.message_type === 'announcement'), '관리자 공지 저장·워커 조회');

  const workerNotices = await rpc('get_my_notifications', { p_limit: 20 }, workerToken);
  expect(workerNotices.some((item) => item.event_type === 'workroom.announcement' && item.data?.facilityId === facilityId), '워크룸 공지가 앱 알림함에 저장');
} finally {
  if (workerToken) await rpc('reset_gigworker_invite_demo', {}, workerToken).catch(() => undefined);
  if (facilityId) {
    await jsonFetch(`${supabaseUrl}/rest/v1/facility_workroom_messages?facility_id=eq.${facilityId}&created_at=gte.${encodeURIComponent(startedAt)}`, {
      method: 'DELETE', headers: restHeaders('', true, { Prefer: 'return=minimal' }),
    }).catch(() => undefined);
    const contained = encodeURIComponent(JSON.stringify({ facilityId }));
    await jsonFetch(`${supabaseUrl}/rest/v1/notification_outbox?created_at=gte.${encodeURIComponent(startedAt)}&data=cs.${contained}`, {
      method: 'DELETE', headers: restHeaders('', true, { Prefer: 'return=minimal' }),
    }).catch(() => undefined);
  }
}

console.log('\n워크룸 운영 QA 통과');
