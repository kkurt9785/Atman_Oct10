// 긱 워크룸 비공개 대화가 실시간 채널로도 새지 않는지 확인한다 (운영 DB, 데모 계정).
// 워커 A(긱 데모)가 facility_workroom_messages INSERT 를 구독한 상태에서 서비스 키로
//   ① 전체 공지(staff_id null) ② A 에게 온 비공개 ③ 다른 근무자 B 에게 온 비공개 를 넣고,
// A 가 ①②만 받고 ③은 못 받는지(REST 조회도 동일) 본다. Supabase realtime 이 RLS 를 지킨다는 전제를 실측한다.
import { createRequire } from 'node:module';
// 레포 루트에는 node_modules 가 없다 — 워커 앱의 supabase-js 를 빌려 쓴다
const require = createRequire(new URL('../apps/worker-web/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const workerOrigin = process.env.QA_WORKER_ORIGIN ?? 'https://itdot.co.kr';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('Supabase QA 환경 변수가 필요합니다.');

const startedAt = new Date().toISOString();
const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
let worker = null, workerToken = '', facilityId = '', staffId = '', otherStaffId = '', channel = null;
const failures = [];
function expect(condition, label) { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures.push(label); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const login = await fetch(`${workerOrigin}/api/demo-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'GIG2026' }) }).then((r) => r.json());
  workerToken = login.accessToken;
  worker = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${workerToken}` } } });
  await worker.realtime.setAuth(workerToken);
  await service.from('facility_staff_invites').update({ phone_normalized: null }).eq('token', login.gigInviteToken);
  const { error: claimError } = await worker.rpc('claim_facility_staff_invite', { p_token: login.gigInviteToken });
  if (claimError) throw claimError;
  const { data: rooms } = await worker.rpc('get_my_workrooms_v2');
  const room = (rooms ?? []).find((item) => item.registration_source === 'gigworker_trial');
  facilityId = room.facility_id; staffId = room.staff_id;
  expect(Boolean(facilityId && staffId), '긱 데모 워커 로그인·초대 연결');

  // 같은 근무지에 다른 근무자 B (앱 미연결) 를 임시로 만든다
  const { data: other, error: otherError } = await service.from('facility_staff').insert({
    facility_id: facilityId, name: '[QA] 다른 근무자', role: 'other', source: 'direct', engagement_type: 'temporary',
    contract_start: startedAt.slice(0, 10), contract_end: startedAt.slice(0, 10), default_start_time: '10:00', default_end_time: '18:00',
    default_break_minutes: 60, work_weekdays: [1, 2, 3, 4, 5, 6, 7], status: 'active',
  }).select('id').single();
  if (otherError) throw otherError;
  otherStaffId = other.id;

  const received = [];
  channel = worker.channel(`qa-rls-${facilityId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'facility_workroom_messages', filter: `facility_id=eq.${facilityId}` }, (payload) => received.push(payload.new));
  const status = await new Promise((resolve) => { channel.subscribe((state, err) => { console.log('  channel:', state, err?.message ?? ''); if (state === 'SUBSCRIBED' || state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') resolve(state); }); setTimeout(() => resolve('TIMEOUT'), 15_000); });
  expect(status === 'SUBSCRIBED', `워커 실시간 구독 (${status})`);

  const tag = Date.now();
  const rows = [
    { facility_id: facilityId, staff_id: null, sender_type: 'admin', sender_name: 'QA', message_type: 'announcement', body: `[QA-rt] 공지 ${tag}`, metadata: {} },
    { facility_id: facilityId, staff_id: staffId, sender_type: 'admin', sender_name: 'QA', message_type: 'message', body: `[QA-rt] 나에게 ${tag}`, metadata: { kind: 'direct' } },
    { facility_id: facilityId, staff_id: otherStaffId, sender_type: 'admin', sender_name: 'QA', message_type: 'message', body: `[QA-rt] 남에게 ${tag}`, metadata: { kind: 'direct' } },
  ];
  for (const row of rows) { const { error } = await service.from('facility_workroom_messages').insert(row); if (error) throw error; await sleep(300); }
  await sleep(6000);

  const bodies = received.map((row) => row.body);
  expect(bodies.includes(rows[0].body), '실시간: 전체 공지 수신');
  expect(bodies.includes(rows[1].body), '실시간: 나에게 온 비공개 수신');
  expect(!bodies.includes(rows[2].body), '실시간: 다른 근무자 비공개는 수신 안 됨 (RLS 적용)');

  const { data: visible } = await worker.from('facility_workroom_messages').select('body,staff_id').eq('facility_id', facilityId).gte('created_at', startedAt);
  const seen = (visible ?? []).map((row) => row.body);
  expect(seen.includes(rows[0].body) && seen.includes(rows[1].body) && !seen.includes(rows[2].body), 'REST 조회도 같은 경계');

  // 워커가 남의 staff_id 로 메시지를 만들려는 시도는 RPC 가 막는다
  const { error: forged } = await worker.rpc('send_staff_workroom_message', { p_staff_id: otherStaffId, p_body: '[QA-rt] 위조 시도' });
  expect(Boolean(forged), `워커의 타인 대화 작성 차단 (${forged?.message ?? '통과됨!'})`);
} finally {
  if (channel) await worker.removeChannel(channel).catch(() => undefined);
  if (facilityId) await service.from('facility_workroom_messages').delete().eq('facility_id', facilityId).gte('created_at', startedAt);
  if (otherStaffId) await service.from('facility_staff').delete().eq('id', otherStaffId);
  if (worker) { try { await worker.rpc('reset_gigworker_invite_demo'); } catch { /* 정리 실패는 무시 */ } }
}
if (failures.length) { console.log(`\n실시간 RLS QA 실패 ${failures.length}건`); process.exit(1); }
console.log('\n실시간 RLS QA 통과');
