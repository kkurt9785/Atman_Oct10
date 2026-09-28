// 근무자 축(worker_kind) + 근무 건(gig_projects) 운영 QA — 병원 데모 사업장에 긱 근무 건을 만들고
// 의료 데모 워커가 초대를 받아 긱 셸로 연결되는지, 근무 건 수정이 참여 일정에 따라가는지 본다. 끝나면 전부 지운다.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/worker-web/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const workerOrigin = process.env.QA_WORKER_ORIGIN ?? 'https://itdot.co.kr';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('Supabase QA 환경 변수가 필요합니다.');

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const failures = [];
const expect = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures.push(label); };
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + 9 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
let projectId = '', staffId = '', worker = null, workerId = null;

try {
  const { data: hospital } = await service.from('facilities').select('id,name,facility_type').eq('name', 'W여성병원').eq('is_demo', true).is('deleted_at', null).maybeSingle();
  expect(Boolean(hospital?.id) && hospital.facility_type !== 'gigworker', `병원 데모 사업장 확보 (${hospital?.name})`);

  // 1) 근무 건 만들기 (관리자 앱은 서비스 키로 같은 insert 를 한다)
  const { data: project, error: projectError } = await service.from('gig_projects').insert({
    facility_id: hospital.id, title: '[QA] 주말 팝업 행사', starts_on: plus(1), ends_on: plus(2), work_weekdays: [1, 2, 3, 4, 5, 6, 7],
    start_time: '10:00', end_time: '18:00', break_minutes: 60, pay_basis: 'hourly', pay_rate: 15000, headcount: 2,
  }).select('id').single();
  expect(!projectError && project?.id, `병원에 근무 건 생성 ${projectError?.message ?? ''}`);
  projectId = project.id;

  // 2) 긱 근무자 등록 + 참여 + 초대 (inviteGigParticipantAction 과 같은 순서)
  const { data: staff, error: staffError } = await service.from('facility_staff').insert({
    facility_id: hospital.id, name: '[QA] 긱 근무자', worker_kind: 'gig', role: 'other', department: '[QA] 주말 팝업 행사', source: 'direct',
    engagement_type: 'temporary', contract_start: plus(1), contract_end: plus(2), work_weekdays: [1, 2, 3, 4, 5, 6, 7],
    default_start_time: '10:00', default_end_time: '18:00', default_break_minutes: 60, pay_basis: 'hourly', pay_rate: 15000,
  }).select('id').single();
  expect(!staffError && staff?.id, `병원에 긱 근무자 등록 ${staffError?.message ?? ''}`);
  staffId = staff.id;
  const { data: compat } = await service.from('gig_assignments').select('id,source').eq('staff_id', staffId);
  expect((compat ?? []).some((row) => row.source === 'staff_compat'), '병원 소속이어도 worker_kind=gig 면 호환 근무 건이 생김');
  const { error: assignError } = await service.from('gig_assignments').insert({ facility_id: hospital.id, staff_id: staffId, project_id: projectId });
  expect(!assignError, `근무 건 참여 ${assignError?.message ?? ''}`);
  const { data: filled } = await service.from('gig_assignments').select('title,start_time,pay_rate,source,status').eq('project_id', projectId).eq('staff_id', staffId).maybeSingle();
  expect(filled?.title === '[QA] 주말 팝업 행사' && filled?.pay_rate === 15000 && filled?.source === 'admin' && filled?.status === 'active', '참여 건이 근무 건 일정·시급을 그대로 받음');
  const { data: invite } = await service.from('facility_staff_invites').insert({ facility_id: hospital.id, staff_id: staffId, phone_normalized: null }).select('token').single();

  // 3) 초대 미리보기: 사업장은 병원이지만 근무자가 긱 → 긱 셸에서 수락
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: preview } = await anon.rpc('get_facility_staff_invite_preview', { p_token: invite.token });
  expect(preview?.ok === true && preview?.isGigworker === true, '병원 초대인데 isGigworker=true (근무자 기준)');

  // 4) 이 병원에 아직 직원으로 연결되지 않은 의료 데모 워커를 골라 초대를 수락시킨다
  //    (한 워커는 한 근무지에 연결 하나 — 간호사 데모는 이미 W여성병원 직원이라 거부되는 게 맞다)
  let login = null;
  for (const email of ['worker-demo-6@demo.atman.co.kr', 'worker-demo-5@demo.atman.co.kr', 'worker-demo-2@demo.atman.co.kr']) {
    const { data: w } = await service.from('workers').select('id').eq('email', email).is('deleted_at', null).maybeSingle();
    if (!w) continue;
    const { count } = await service.from('facility_staff').select('id', { count: 'exact', head: true }).eq('facility_id', hospital.id).eq('worker_id', w.id);
    if ((count ?? 0) > 0) continue;
    login = await fetch(`${workerOrigin}/api/demo-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).then((r) => r.json());
    login.email = email; break;
  }
  expect(Boolean(login?.accessToken), `병원 미연결 의료 데모 워커 확보 (${login?.email ?? '없음'})`);
  worker = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${login.accessToken}` } } });
  const { data: claimed, error: claimError } = await worker.rpc('claim_facility_staff_invite', { p_token: invite.token });
  expect(!claimError && claimed === staffId, `의료 데모 워커가 병원 긱 초대 수락 ${claimError?.message ?? ''}`);
  const { data: links } = await worker.from('facility_staff').select('id,worker_kind,status').eq('id', staffId).maybeSingle();
  expect(links?.worker_kind === 'gig', '워커가 자기 연결의 worker_kind=gig 를 읽음 (셸 판정 재료)');
  const { data: rooms } = await worker.rpc('get_my_workrooms_v2');
  const room = (rooms ?? []).find((r) => r.staff_id === staffId);
  expect(room?.worker_kind === 'gig' && room?.facility_id === hospital.id, '워크룸 목록 v2 가 병원 방을 긱(worker_kind) 으로 표시');
  const { data: visibleProject } = await worker.from('gig_projects').select('id,title').eq('id', projectId).maybeSingle();
  expect(visibleProject?.title === '[QA] 주말 팝업 행사', '워커가 참여한 근무 건만 읽을 수 있음 (RLS)');

  // 5) 근무 건 수정 → 참여 일정 따라감 (트리거)
  await service.from('gig_projects').update({ start_time: '11:00', pay_rate: 16000 }).eq('id', projectId);
  const { data: synced } = await service.from('gig_assignments').select('start_time,pay_rate').eq('project_id', projectId).eq('staff_id', staffId).maybeSingle();
  expect(String(synced?.start_time).startsWith('11:00') && synced?.pay_rate === 16000, '근무 건 시간·시급 수정이 참여 건에 반영');

  // 6) 긱 근무자는 병원 전체방에 글을 못 쓴다 (worker_kind 기준 트리거)
  let blocked = false;
  try { const { error } = await worker.rpc('send_facility_workroom_message', { p_facility_id: hospital.id, p_body: '[QA] 전체방', p_announcement: false }); blocked = Boolean(error && String(error.message).includes('비공개')); } catch { blocked = true; }
  expect(blocked, '병원 소속 긱 근무자도 전체방 글쓰기 차단');

  // 7) 취소 → 참여 건 취소
  await service.from('gig_projects').update({ status: 'cancelled' }).eq('id', projectId);
  const { data: afterCancel } = await service.from('gig_assignments').select('status').eq('project_id', projectId).eq('staff_id', staffId).maybeSingle();
  expect(afterCancel?.status === 'cancelled', '근무 건 취소가 참여 건에 반영');
} finally {
  // PostgrestBuilder 는 .catch 가 없다 — try 로 감싼다
  const quiet = async (fn) => { try { await fn(); } catch { /* 정리 실패는 무시 */ } };
  if (staffId) {
    await quiet(() => service.from('facility_workroom_messages').delete().eq('staff_id', staffId));
    await quiet(() => service.from('facility_staff').delete().eq('id', staffId));
  }
  if (projectId) await quiet(() => service.from('gig_projects').delete().eq('id', projectId));
  await quiet(() => service.from('notification_outbox').delete().like('body', '%[QA]%'));
}
if (failures.length) { console.log(`\n근무 건 QA 실패 ${failures.length}건`); process.exit(1); }
console.log('\n근무자 축 + 근무 건 QA 통과');
