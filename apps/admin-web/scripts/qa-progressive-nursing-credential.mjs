import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !serviceKey) throw new Error('QA environment is incomplete');

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
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
try {
  await service.rpc('reset_three_facility_live_demo', { p_facility_id: facility.id });
  const { error: pendingError } = await service.from('workers').update({ verification_status: 'pending', verified_at: null }).eq('id', workerRow.id);
  if (pendingError) throw pendingError;

  const { data: shifts, error: discoveryError } = await worker.rpc('get_nearby_open_shifts_secure', {
    p_lat: null, p_lng: null, p_pref_labels: null,
  });
  if (discoveryError) throw discoveryError;
  const shift = (shifts ?? []).find((row) => row.facility_name === facility.name && row.required_role === 'rn');
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

  const { data: confirmed, error: confirmError } = await admin.rpc('confirm_application_credential', { p_application_id: applicationId });
  if (confirmError || confirmed !== true) throw new Error(`credential confirmation failed: ${confirmError?.message}`);
  const { error: acceptError } = await admin.rpc('accept_shift_application', { p_application_id: applicationId });
  if (acceptError) throw new Error(`accept after credential confirmation failed: ${acceptError.message}`);

  console.log(JSON.stringify({
    facility: facility.name,
    discoveryWithoutUpload: true,
    matchedNotificationWithoutUpload: true,
    applicationWithoutUpload: true,
    prematureAcceptanceBlocked: true,
    facilityCredentialAudit: true,
    acceptedAfterConfirmation: true,
  }, null, 2));
} finally {
  await service.from('workers').update({
    verification_status: workerRow.verification_status,
    verified_at: workerRow.verified_at,
  }).eq('id', workerRow.id);
  await service.rpc('reset_three_facility_live_demo', { p_facility_id: facility.id });
  if (applicationId) {
    await service.from('notification_outbox').delete().or(`dedupe_key.eq.shift.applied:${applicationId},dedupe_key.eq.shift.accepted:${applicationId}`);
  }
}
