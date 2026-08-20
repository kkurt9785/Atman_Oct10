import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !serviceKey) throw new Error('QA environment is incomplete');

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
// demo-1은 시연용 오전 시프트가 이미 확정될 수 있어, 격리 QA 계정으로 실행한다.
const workerEmail = 'worker-demo-1@demo.atman.co.kr';
const adminEmail = 'sales-demo-1@demo.atman.co.kr';

async function signedIn(email) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError || !link?.properties?.hashed_token) throw new Error(`${email}: ${linkError?.message ?? 'magic link failed'}`);
  const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (error) throw error;
  return client;
}

const { data: facility, error: facilityError } = await service.from('facilities')
  .select('id,name').eq('business_registration_number', 'DEMO-TARGET-0001').single();
if (facilityError) throw facilityError;

const worker = await signedIn(workerEmail);
const admin = await signedIn(adminEmail);
const { data: { user: workerUser } } = await worker.auth.getUser();
if (!workerUser) throw new Error('demo worker auth user is missing');
const { data: workerRow, error: workerError } = await service.from('workers')
  .select('id,verification_status,verified_at').eq('auth_user_id', workerUser.id).single();
if (workerError) throw workerError;

let applicationId = null;
let displacedAccepted = [];
try {
  await service.rpc('reset_three_facility_live_demo', { p_facility_id: facility.id });
  const { error: pendingError } = await service.from('workers').update({ verification_status: 'pending', verified_at: null }).eq('id', workerRow.id);
  if (pendingError) throw pendingError;

  // 시연 계정의 기존 확정 시프트가 새 QA 시프트와 겹칠 수 있어
  // 테스트 동안만 보류하고 finally에서 원래 상태로 복원한다.
  const { data: acceptedRows } = await service.from('shift_applications')
    .select('id,status').eq('worker_id', workerRow.id).eq('status', 'accepted');
  displacedAccepted = acceptedRows ?? [];
  if (displacedAccepted.length) {
    await service.from('shift_applications').update({ status: 'rejected' })
      .in('id', displacedAccepted.map((row) => row.id));
  }

  const { data: shifts, error: discoveryError } = await worker.rpc('get_nearby_open_shifts_secure', {
    p_lat: null, p_lng: null, p_pref_labels: null,
  });
  if (discoveryError) throw discoveryError;
  // 데모 워커에 이미 오전 확정 시프트가 있어도 QA가 충돌하지 않도록
  // 같은 시설·직군의 가장 늦은 오늘 시프트를 선택한다.
  const shift = (shifts ?? [])
    .filter((row) => row.facility_name === facility.name && row.required_role === 'rn')
    .sort((a, b) => String(b.start_time ?? '').localeCompare(String(a.start_time ?? '')))[0];
  if (!shift) throw new Error('unverified nurse cannot discover the demo shift');
  const { data: recipients, error: recipientError } = await service.rpc('get_shift_notification_recipients', { p_shift_id: shift.id });
  if (recipientError || !(recipients ?? []).some((row) => row.auth_user_id === workerUser.id)) {
    throw new Error('unverified nurse is missing from matched shift notifications');
  }

  const { data: applied, error: applyError } = await worker.rpc('apply_to_shift', { p_shift_id: shift.id });
  if (applyError || !applied) throw new Error(`unverified nurse apply failed: ${applyError?.message}`);
  applicationId = applied;

  const { data: application } = await service.from('shift_applications')
    .select('credential_review_status').eq('id', applicationId).single();
  if (application?.credential_review_status !== 'pending_facility_check') throw new Error('application credential state is not pending');

  const { error: prematureAcceptError } = await admin.rpc('accept_shift_application', { p_application_id: applicationId });
  if (!prematureAcceptError?.message.includes('자격 확인')) throw new Error('acceptance was not blocked before credential confirmation');

  const { data: confirmed, error: confirmError } = await admin.rpc('confirm_application_credential', {
    p_application_id: applicationId, p_verification_method: 'official_lookup',
  });
  if (confirmError || confirmed !== true) throw new Error(`credential confirmation failed: ${confirmError?.message}`);
  const { data: confirmedApplication } = await service.from('shift_applications')
    .select('credential_verification_method').eq('id', applicationId).single();
  if (confirmedApplication?.credential_verification_method !== 'official_lookup') throw new Error('verification method audit value missing');
  const { data: confirmationNotifications, error: notificationError } = await service
    .from('notification_outbox').select('event_type,dedupe_key')
    .or(`dedupe_key.like.credential.confirmed:${applicationId}:%,dedupe_key.like.credential.confirmed.admin:${applicationId}:%`);
  if (notificationError || !(confirmationNotifications ?? []).some((row) => row.event_type === 'credential.confirmed')
    || !(confirmationNotifications ?? []).some((row) => row.event_type === 'credential.confirmed.admin')) {
    throw new Error(`credential confirmation notifications missing: ${notificationError?.message ?? 'fanout incomplete'}`);
  }
  const { error: acceptError } = await admin.rpc('accept_shift_application', { p_application_id: applicationId });
  if (acceptError) throw new Error(`accept after credential confirmation failed: ${acceptError.message}`);

  console.log(JSON.stringify({
    facility: facility.name,
    discoveryWithoutUpload: true,
    matchedNotificationWithoutUpload: true,
    applicationWithoutUpload: true,
    prematureAcceptanceBlocked: true,
    facilityCredentialAudit: true,
    verificationMethodAudited: true,
    confirmationNotificationsFanout: true,
    acceptedAfterConfirmation: true,
  }, null, 2));
} finally {
  await service.from('workers').update({
    verification_status: workerRow.verification_status,
    verified_at: workerRow.verified_at,
  }).eq('id', workerRow.id);
  await service.rpc('reset_three_facility_live_demo', { p_facility_id: facility.id });
  for (const row of displacedAccepted) {
    await service.from('shift_applications').update({ status: row.status }).eq('id', row.id);
  }
  if (applicationId) {
    await service.from('notification_outbox').delete().or(`dedupe_key.eq.shift.applied:${applicationId},dedupe_key.eq.shift.accepted:${applicationId},dedupe_key.like.credential.confirmed:${applicationId}:%,dedupe_key.like.credential.confirmed.admin:${applicationId}:%`);
  }
}
