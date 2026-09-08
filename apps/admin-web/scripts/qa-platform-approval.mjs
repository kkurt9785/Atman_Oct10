import { createClient } from '@supabase/supabase-js';
import { approveFacilityCore, rejectFacilityCore, normalizeBrn } from '../lib/platform-approval.ts';

// 승인/반려 코어 회귀: 임시 관리자 2명이 셀프 등록 → 목록 RPC 노출 → 1건 승인(BRN 정규화·중복 차단·알림) → 1건 반려(소유 해제·재등록 가능) → 정리
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !svc) throw new Error('QA environment is incomplete');
const service = createClient(url, svc, { auth: { persistSession: false } });
const actor = { id: '00000000-0000-0000-0000-00000000a11e', email: 'qa-platform@atman.test' };
const stamp = Date.now();
const users = [];
const results = {};

async function tempAdmin(tag) {
  const email = `qa-approve-${tag}-${stamp}@demo.atman.co.kr`;
  const { data: u, error } = await service.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  users.push(u.user.id);
  await service.from('profiles').upsert({ id: u.user.id, role: 'admin', onboarding_done: true });
  const { data: link } = await service.auth.admin.generateLink({ type: 'magiclink', email });
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  return { client: c, id: u.user.id, email };
}
async function register(admin, suffix) {
  const { data: id, error } = await admin.client.rpc('register_facility_self', {
    p_name: `QA 승인테스트 ${suffix}`, p_facility_type: 'small_hospital', p_address_text: '경기 수원시 팔달구 매산로 30',
    p_lng: 127.0048, p_lat: 37.2676, p_phone: '031-000-0000', p_hira_ykiho: `QA-APPR-${suffix}-${stamp}`, p_hira_cl_cd: '31', p_bed_count: null, p_source: 'self_hira',
  });
  if (error) throw error;
  return id;
}

try {
  const a = await tempAdmin('a'), b = await tempAdmin('b');
  const fa = await register(a, 'A'), fb = await register(b, 'B');

  const { data: pending } = await service.rpc('platform_list_self_registered_facilities', { p_pending_only: true });
  const rowA = (pending ?? []).find((r) => r.id === fa);
  results.listShowsPendingWithEmailAndCoords = Boolean(rowA) && rowA.admin_email === a.email && Math.abs(rowA.lng - 127.0048) < 1e-4 && rowA.approved_at === null;
  const { data: anonTry } = await a.client.rpc('platform_list_self_registered_facilities', { p_pending_only: true });
  results.listHiddenFromFacilityAdmin = !anonTry;

  // 사업자등록증 업로드(본인 폴더) → 제출 RPC → 목록에 노출 → 타인 열람·타인 제출·경로 위조 차단
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const docPath = `${a.id}/${fa}/brn-qa.png`;
  const { error: upErr } = await a.client.storage.from('facility-documents').upload(docPath, png, { contentType: 'image/png', upsert: false });
  results.documentUploadOwnFolder = !upErr;
  const { error: strangerUp } = await b.client.storage.from('facility-documents').upload(`${a.id}/${fa}/hijack.png`, png, { contentType: 'image/png' });
  results.documentUploadForeignFolderBlocked = Boolean(strangerUp);
  const { data: strangerRead } = await b.client.storage.from('facility-documents').download(docPath).catch(() => ({ data: null }));
  results.documentPrivateFromStranger = !strangerRead;
  const { error: submitErr } = await a.client.rpc('submit_facility_brn_document', { p_facility_id: fa, p_brn_submitted: '123 45 67890', p_document_path: docPath });
  results.brnDocumentSubmitted = !submitErr;
  const { error: spoof } = await a.client.rpc('submit_facility_brn_document', { p_facility_id: fa, p_document_path: `${b.id}/${fa}/x.png` });
  results.documentPathSpoofBlocked = /경로가 올바르지/.test(spoof?.message ?? '');
  const { error: foreignSubmit } = await b.client.rpc('submit_facility_brn_document', { p_facility_id: fa, p_brn_submitted: '9999999999' });
  results.foreignSubmitBlocked = /권한이 없어요/.test(foreignSubmit?.message ?? '');
  const { data: pending2 } = await service.rpc('platform_list_self_registered_facilities', { p_pending_only: true });
  const rowA2 = (pending2 ?? []).find((r) => r.id === fa);
  results.listShowsSubmittedBrnAndDoc = rowA2?.brn_submitted === '123-45-67890' && rowA2?.brn_document_path === docPath;
  const { data: signed } = await service.storage.from('facility-documents').createSignedUrl(docPath, 60);
  results.operatorSignedUrl = Boolean(signed?.signedUrl);

  results.brnNormalized = normalizeBrn('123 45 67890') === '123-45-67890' && normalizeBrn('12345') === null;
  const bad = await approveFacilityCore(service, actor, { facilityId: fa, brn: '12345' });
  results.badBrnBlocked = !bad.ok;
  const ok = await approveFacilityCore(service, actor, { facilityId: fa, brn: `9${String(stamp).slice(-9)}` });
  const { data: afterA } = await service.from('facilities').select('approved_at, business_registration_number').eq('id', fa).single();
  results.approved = ok.ok && Boolean(afterA?.approved_at) && /^\d{3}-\d{2}-\d{5}$/.test(afterA?.business_registration_number ?? '');
  const twice = await approveFacilityCore(service, actor, { facilityId: fa, brn: `9${String(stamp).slice(-9)}` });
  results.doubleApproveBlocked = !twice.ok && /이미 승인/.test(twice.error ?? '');
  const dupe = await approveFacilityCore(service, actor, { facilityId: fb, brn: `9${String(stamp).slice(-9)}` });
  results.duplicateBrnBlocked = !dupe.ok && /이미 있어요/.test(dupe.error ?? '');
  const { data: notifA } = await service.from('notification_outbox').select('event_type').eq('dedupe_key', `facility.approved:${fa}`).maybeSingle();
  results.approvalNotificationQueued = notifA?.event_type === 'facility.approved';
  const { data: auditA } = await service.from('audit_logs').select('action').eq('entity_id', fa).eq('action', 'facility.self_registration.approve').maybeSingle();
  results.approvalAudited = Boolean(auditA);

  const rej = await rejectFacilityCore(service, actor, { facilityId: fb, reason: 'QA 반려 사유' });
  const { data: afterB } = await service.from('facilities').select('is_active, deleted_at, admin_user_id').eq('id', fb).single();
  results.rejected = rej.ok && afterB?.is_active === false && Boolean(afterB?.deleted_at) && afterB?.admin_user_id === null;
  const fb2 = await register(b, 'B2'); // 반려 뒤 같은 관리자가 다시 등록 가능해야 한다 (admin_user_id UNIQUE 해제 확인)
  results.reregisterAfterReject = Boolean(fb2);
  const { data: notifB } = await service.from('notification_outbox').select('body').eq('dedupe_key', `facility.rejected:${fb}`).maybeSingle();
  results.rejectionNotificationCarriesReason = /QA 반려 사유/.test(notifB?.body ?? '');
} finally {
  for (const uid of users) {
    const { data: objs } = await service.storage.from('facility-documents').list(uid, { limit: 100 });
    for (const o of objs ?? []) {
      const { data: inner } = await service.storage.from('facility-documents').list(`${uid}/${o.name}`, { limit: 100 });
      if (inner?.length) await service.storage.from('facility-documents').remove(inner.map((i) => `${uid}/${o.name}/${i.name}`));
    }
  }
  const { data: leftovers } = await service.from('facilities').select('id').like('hira_ykiho', `QA-APPR-%`);
  for (const f of leftovers ?? []) {
    await service.from('facility_subscriptions').delete().eq('facility_id', f.id);
    await service.from('audit_logs').delete().eq('entity_id', f.id);
    await service.from('notification_outbox').delete().like('dedupe_key', `facility.%:${f.id}`);
    const { error } = await service.from('facilities').delete().eq('id', f.id);
    if (error) console.error('cleanup facility failed', f.id, error.message);
  }
  for (const uid of users) { const { error } = await service.auth.admin.deleteUser(uid); if (error) console.error('cleanup user failed', uid, error.message); }
}
console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some((v) => v !== true)) process.exit(1);
