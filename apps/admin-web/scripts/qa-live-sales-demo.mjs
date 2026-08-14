import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !serviceKey) throw new Error('QA environment is incomplete');

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const scenarios = [
  { registration: 'DEMO-TARGET-0001', worker: 'worker-demo-1@demo.atman.co.kr', admin: 'sales-demo-1@demo.atman.co.kr', tag: 'LIVE-SALES-DEMO-W' },
  { registration: 'DEMO-TARGET-0026', worker: 'worker-demo-1@demo.atman.co.kr', admin: 'sales-demo-3@demo.atman.co.kr', tag: 'LIVE-SALES-DEMO-CARE' },
  { registration: 'DEMO-TARGET-PHARMACY', worker: 'worker-demo-2@demo.atman.co.kr', admin: 'sales-demo-2@demo.atman.co.kr', tag: 'LIVE-SALES-DEMO-PHARMACY' },
  { registration: 'DEMO-TARGET-0026', worker: 'worker-demo-5@demo.atman.co.kr', admin: 'sales-demo-3@demo.atman.co.kr', tag: 'LIVE-SALES-DEMO-CARE-NA' },
  { registration: 'DEMO-TARGET-PHARMACY', worker: 'worker-demo-6@demo.atman.co.kr', admin: 'sales-demo-2@demo.atman.co.kr', tag: 'LIVE-SALES-DEMO-PHARMACIST' },
];

async function signedIn(email) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError || !link?.properties?.hashed_token) throw new Error(`${email} link: ${linkError?.message}`);
  const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (error) throw new Error(`${email} login: ${error.message}`);
  return client;
}

const results = [];
const qaOutboxIds = [];
try {
  for (const scenario of scenarios) {
    const { data: facility, error: facilityError } = await service.from('facilities')
      .select('id,name').eq('business_registration_number', scenario.registration).eq('is_demo', true).eq('is_active', true).single();
    if (facilityError) throw facilityError;
    const { error: resetError } = await service.rpc('reset_three_facility_live_demo', { p_facility_id: facility.id });
    if (resetError) throw resetError;
    const { data: shift, error: shiftError } = await service.from('shifts')
      .select('id,required_role,status').eq('facility_id', facility.id).eq('notes', scenario.tag).single();
    if (shiftError) throw shiftError;

    const worker = await signedIn(scenario.worker);
    const { data: visible, error: visibleError } = await worker.rpc('get_nearby_open_shifts_secure', {
      p_lat: null, p_lng: null, p_pref_labels: null,
    });
    if (visibleError || !(visible ?? []).some((row) => row.id === shift.id)) throw new Error(`${facility.name}: live shift is not visible to worker`);
    const { data: applicationId, error: applyError } = await worker.rpc('apply_to_shift', { p_shift_id: shift.id });
    if (applyError || !applicationId) throw new Error(`${facility.name}: apply failed: ${applyError?.message}`);

    const { data: adminApplyOutbox } = await service.from('notification_outbox').select('id,worker_auth_user_id')
      .eq('event_type', 'shift.applied').like('dedupe_key', `shift.applied:${applicationId}:%`);
    if (!adminApplyOutbox?.length) throw new Error(`${facility.name}: admin application notification missing`);
    qaOutboxIds.push(...adminApplyOutbox.map((row) => row.id));

    const admin = await signedIn(scenario.admin);
    const { error: acceptError } = await admin.rpc('accept_shift_application', { p_application_id: applicationId });
    if (acceptError) throw new Error(`${facility.name}: accept failed: ${acceptError.message}`);
    const { data: acceptedOutbox } = await service.from('notification_outbox').select('id')
      .eq('event_type', 'shift.accepted').eq('dedupe_key', `shift.accepted:${applicationId}`);
    if (!acceptedOutbox?.length) throw new Error(`${facility.name}: worker accepted notification missing`);
    qaOutboxIds.push(...acceptedOutbox.map((row) => row.id));

    const { data: workerMessage, error: workerChatError } = await worker.rpc('send_chat_message', {
      p_application_id: applicationId, p_body: 'QA 워커 메시지입니다.',
    });
    if (workerChatError || workerMessage?.sender_type !== 'worker') throw new Error(`${facility.name}: worker chat failed`);
    const { data: adminChatOutbox } = await service.from('notification_outbox').select('id')
      .eq('event_type', 'chat.message').like('dedupe_key', `chat.admin:${workerMessage.id}:%`);
    if (!adminChatOutbox?.length) throw new Error(`${facility.name}: admin chat notification missing`);
    qaOutboxIds.push(...adminChatOutbox.map((row) => row.id));

    const { data: adminMessage, error: adminChatError } = await admin.rpc('send_chat_message', {
      p_application_id: applicationId, p_body: 'QA 관리자 메시지입니다.',
    });
    if (adminChatError || adminMessage?.sender_type !== 'facility') throw new Error(`${facility.name}: admin chat failed`);
    const { data: workerChatOutbox } = await service.from('notification_outbox').select('id')
      .eq('event_type', 'chat.message').eq('dedupe_key', `chat:${adminMessage.id}`);
    if (!workerChatOutbox?.length) throw new Error(`${facility.name}: worker chat notification missing`);
    qaOutboxIds.push(...workerChatOutbox.map((row) => row.id));

    results.push({ facility: facility.name, shiftVisible: true, applied: true, adminNotified: true, accepted: true, workerNotified: true, twoWayChat: true, twoWayChatNotified: true });
    await service.rpc('reset_three_facility_live_demo', { p_facility_id: facility.id });
  }
} finally {
  if (qaOutboxIds.length) await service.from('notification_outbox').delete().in('id', qaOutboxIds);
  for (const scenario of scenarios) {
    const { data: facility } = await service.from('facilities').select('id')
      .eq('business_registration_number', scenario.registration).eq('is_demo', true).eq('is_active', true).maybeSingle();
    if (facility) await service.rpc('reset_three_facility_live_demo', { p_facility_id: facility.id });
  }
}

console.log(JSON.stringify(results, null, 2));
