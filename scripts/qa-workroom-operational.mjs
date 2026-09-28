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
  // 9/28 이후: 긱 워크룸은 '전체 공지(staff_id null)' + '근무자별 비공개 대화(staff_id)' 로 나뉜다. get_my_workrooms_v2 가 staff_id 를 준다.
  const workerRooms = await rpc('get_my_workrooms_v2', {}, workerToken);
  const room = workerRooms.find((item) => item.registration_source === 'gigworker_trial');
  expect(Boolean(room?.facility_id && room?.staff_id), '워커 계정과 사업장 워크룸 자동 연결 (v2, staff_id 포함)');
  facilityId = room.facility_id;
  const staffId = room.staff_id;

  // 긱워커는 전체방에 쓸 수 없다 — DB 트리거가 막아야 한다
  let blocked = false;
  try { await rpc('send_facility_workroom_message', { p_facility_id: facilityId, p_body: '[QA] 전체방 시도', p_announcement: false }, workerToken); }
  catch (error) { blocked = String(error.message).includes('비공개 대화'); }
  expect(blocked, '긱워커의 전체방 글쓰기를 DB 가 차단');

  const workerBody = `[QA] 워커 비공개 메시지 ${Date.now()}`;
  const sent = await rpc('send_staff_workroom_message', { p_staff_id: staffId, p_body: workerBody }, workerToken);
  expect(sent?.staff_id === staffId && sent?.sender_type === 'worker', '워커 → 관리자 비공개 메시지 전송');

  const adminLogin = await jsonFetch(`${adminOrigin}/api/demo-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sales-demo-1@demo.atman.co.kr' }),
  });
  const adminToken = adminLogin.accessToken;
  const members = await rpc('get_admin_workroom_members', { p_facility_id: facilityId }, adminToken);
  const me = members.find((item) => item.staff_id === staffId);
  expect(Boolean(me?.worker_linked) && Number(me?.unread_count) >= 1, '관리자 목록에 연결 근무자 + 미확인 1건');

  const adminBody = `[QA] 관리자 공지 ${Date.now()}`;
  await rpc('send_facility_workroom_message', { p_facility_id: facilityId, p_body: adminBody, p_announcement: true }, adminToken);
  const directBody = `[QA] 관리자 개인 메시지 ${Date.now()}`;
  await rpc('send_staff_workroom_message', { p_staff_id: staffId, p_body: directBody }, adminToken);
  const checkCount = await rpc('create_staff_workroom_checks', { p_facility_id: facilityId, p_staff_ids: [staffId], p_body: '[QA] 내일 출근 확인해 주세요', p_due_at: null }, adminToken);
  expect(Number(checkCount) === 1, '관리자 → 근무자 개인 출석 확인 요청');

  const visible = await jsonFetch(`${supabaseUrl}/rest/v1/facility_workroom_messages?select=staff_id,sender_type,message_type,body,metadata&facility_id=eq.${facilityId}&created_at=gte.${encodeURIComponent(startedAt)}&order=created_at.asc`, {
    headers: restHeaders(workerToken),
  });
  expect(visible.some((item) => item.body === workerBody && item.sender_type === 'worker' && item.staff_id === staffId), '워커 메시지 저장·조회');
  expect(visible.some((item) => item.body === adminBody && item.message_type === 'announcement' && item.staff_id === null), '관리자 전체 공지 워커 조회');
  expect(visible.some((item) => item.body === directBody && item.staff_id === staffId), '관리자 개인 메시지 워커 조회');
  const check = visible.find((item) => item.metadata?.kind === 'check');
  expect(Boolean(check?.metadata?.checkId), '출석 확인 카드 워커 조회');
  await rpc('reply_workroom_check', { p_check_id: check.metadata.checkId }, workerToken);
  const status = await rpc('get_workroom_check_status', { p_facility_id: facilityId }, adminToken);
  expect(status.some((row) => row.check_id === check.metadata.checkId && row.staff_id === staffId && row.replied_at), '워커 확인 → 관리자 현황에 반영');

  const workerNotices = await rpc('get_my_notifications', { p_limit: 30 }, workerToken);
  expect(workerNotices.some((item) => item.event_type === 'workroom.announcement' && item.data?.facilityId === facilityId), '전체 공지가 워커 알림함에 저장');
  const direct = workerNotices.find((item) => item.event_type === 'workroom.direct' && item.data?.staffId === staffId);
  expect(Boolean(direct), '개인 메시지가 워커 알림함에 저장 (staffId 포함 → 긱 셸 분류)');
  expect(String(direct?.data?.url ?? '').startsWith('/workroom?facility='), '개인 메시지 알림 URL 은 셸 중립(/workroom) — 앱이 셸별로 바꿔 연다');
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
