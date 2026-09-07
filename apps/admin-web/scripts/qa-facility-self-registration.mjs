import { createClient } from '@supabase/supabase-js';

// 셀프 등록 RPC 회귀: 관리자 계정으로 등록 → 컬럼·좌표·승인대기 확인 → 중복 ykiho 차단 → 정리
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !serviceKey) throw new Error('QA environment is incomplete');
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
// admin_user_id UNIQUE → 사업장 없는 임시 관리자를 만들어 돌리고 끝나면 삭제한다.
const adminEmail = `qa-selfreg-${Date.now()}@demo.atman.co.kr`;
const ownerEmail = 'sales-demo-1@demo.atman.co.kr'; // 이미 사업장 소유 → 친절한 차단 메시지 확인용
const ykiho = `QA-SELF-${Date.now()}`;

async function signedIn(email) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError || !link?.properties?.hashed_token) throw new Error(`${email} link: ${linkError?.message}`);
  const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (error) throw error;
  return client;
}

const results = {};
let createdId = null;
let qaUserId = null;
try {
  const { data: created, error: createError } = await service.auth.admin.createUser({ email: adminEmail, email_confirm: true });
  if (createError || !created?.user) throw new Error(`qa admin create: ${createError?.message}`);
  qaUserId = created.user.id;
  const { error: profileError } = await service.from('profiles').upsert({ id: qaUserId, role: 'admin', onboarding_done: true });
  if (profileError) throw new Error(`qa admin profile: ${profileError.message}`);
  const admin = await signedIn(adminEmail);
  const args = { p_name: 'QA 셀프등록 요양병원', p_facility_type: 'care_hospital', p_address_text: '경기 수원시 권선구 금곡로 1', p_lng: 126.95, p_lat: 37.27, p_phone: '031-000-0000', p_hira_ykiho: ykiho, p_hira_cl_cd: '28', p_bed_count: 120, p_source: 'self_hira' };
  const { data: id, error } = await admin.rpc('register_facility_self', args);
  if (error || !id) throw new Error(`register failed: ${error?.message}`);
  createdId = id;
  const { data: row } = await service.from('facilities').select('admin_user_id,approved_at,is_active,hira_ykiho,registration_source,facility_type,plan_code,business_registration_number').eq('id', id).single();
  const { data: { user } } = await admin.auth.getUser();
  results.createdByAdmin = row?.admin_user_id === user?.id;
  results.pendingApproval = row?.approved_at === null && row?.is_active === true;
  results.hiraFieldsStored = row?.hira_ykiho === ykiho && row?.registration_source === 'self_hira' && row?.facility_type === 'care_hospital';
  results.placeholderBrn = typeof row?.business_registration_number === 'string' && row.business_registration_number.startsWith('SELF-');
  const { data: loc } = await service.from('facilities').select('location').eq('id', id).single();
  results.locationStored = typeof loc?.location === 'string' && loc.location.length > 20; // geography는 WKB hex로 내려옴
  const { data: dupe, error: dupeError } = await admin.rpc('register_facility_self', args);
  results.duplicateYkihoBlocked = !dupe && /이미 잇닿에 등록된/.test(dupeError?.message ?? '');
  const { error: badGeo } = await admin.rpc('register_facility_self', { ...args, p_hira_ykiho: `${ykiho}-B`, p_lng: 0, p_lat: 0 });
  results.invalidCoordsBlocked = /위치를 지도에서/.test(badGeo?.message ?? '');
  const { error: secondFacility } = await admin.rpc('register_facility_self', { ...args, p_hira_ykiho: `${ykiho}-C` });
  results.secondFacilityBlocked = /이미 운영 중인 사업장/.test(secondFacility?.message ?? '');
  const owner = await signedIn(ownerEmail);
  const { error: ownerError } = await owner.rpc('register_facility_self', { ...args, p_hira_ykiho: `${ykiho}-D` });
  results.existingOwnerBlocked = /이미 운영 중인 사업장/.test(ownerError?.message ?? '');
} finally {
  // 사업장 INSERT 트리거가 facility_subscriptions(체험 구독)를 만들므로 구독 → 사업장 → 유저 순으로 지운다. 실패는 숨기지 않는다.
  const { data: leftovers } = await service.from('facilities').select('id').like('hira_ykiho', 'QA-SELF-%');
  for (const f of leftovers ?? []) {
    const subs = await service.from('facility_subscriptions').delete().eq('facility_id', f.id);
    const fac = await service.from('facilities').delete().eq('id', f.id);
    if (subs.error || fac.error) console.error('cleanup facility failed', f.id, subs.error?.message ?? fac.error?.message);
  }
  if (qaUserId) {
    const { error } = await service.auth.admin.deleteUser(qaUserId);
    if (error) console.error('cleanup user failed', qaUserId, error.message);
  }
}
console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some((v) => v !== true)) process.exit(1);
