'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient, userClient } from '@/lib/supabase';
import { calcEstimatedShiftPay, MIN_HOURLY_WAGE_2026 } from '@/lib/pay';
import { consumePlanUsage, releasePlanUsage, requirePlanFeature } from '@/lib/billing-gates';
import { isGigworkerFacility } from '@/lib/facility-mode';
import { nudgeNotificationDispatch } from '@/lib/notify-nudge';
import { getVacancyCandidates, parseVacancySource, resolveVacancy, type VacancySource } from '@/lib/db/vacancy';

function sourceQuery(source: VacancySource): string {
  if (source.mode === 'shift') return `shift=${source.shiftId}`;
  if (source.mode === 'replace') return `replace=${source.shiftId}`;
  if (source.mode === 'staff') return `staff=${source.staffId}&date=${source.date}`;
  return `rec=${encodeURIComponent(source.key)}`;
}

function fail(source: VacancySource, message: string): never {
  redirect(`/vacancy?${sourceQuery(source)}&error=${encodeURIComponent(message)}`);
}

// 결원 채우기: 고른 사람에게 요청(먼저 수락한 사람으로 확정) + 원하면 공개 공고로도 연다.
export async function fillVacancyAction(formData: FormData) {
  const source = parseVacancySource(Object.fromEntries(
    ['shift', 'replace', 'staff', 'date', 'rec'].map((key) => [key, String(formData.get(key) ?? '') || undefined]),
  ));
  if (!source) redirect('/operations');
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  const user = userClient(context.accessToken);
  if (!sb || !user) fail(source, '서버 설정을 확인해 주세요.');

  const vacancy = await resolveVacancy(source);
  if (!vacancy) fail(source, '결원 정보를 찾지 못했어요. 운영 화면에서 다시 열어 주세요.');
  if (vacancy.shiftId && vacancy.shiftStatus !== 'open') fail(source, '이미 확정됐거나 닫힌 근무예요.');
  if (vacancy.audience === 'invited') fail(source, '반복근무 요청 근무에는 다른 사람을 추가할 수 없어요.');

  const selected = [...new Set(formData.getAll('worker_id').map(String).filter(Boolean))];
  const makePublic = formData.get('make_public') === 'on';
  if (selected.length === 0 && !makePublic) fail(source, '요청할 사람을 고르거나 공개 공고로 올려 주세요.');

  // 함께 일한 근무자(인력풀)에게 직접 요청하는 건 반복초대 기능 — 직원 요청은 요금제와 관계없이 가능
  const candidates = await getVacancyCandidates(vacancy);
  const poolSelected = candidates.some((c) => c.kind === 'pool' && c.workerId && selected.includes(c.workerId));
  if (poolSelected) {
    try { await requirePlanFeature(sb, context.facilityId, 'repeat_invite'); }
    catch (error) { fail(source, error instanceof Error ? error.message : '요금제를 확인해 주세요.'); }
  }

  const { data: facility } = await sb.from('facilities').select('facility_type,approved_at,registration_source').eq('id', context.facilityId).maybeSingle();
  if (isGigworkerFacility(facility)) fail(source, '긱워커 근태 무료 베타에서는 결원 요청을 쓸 수 없어요.');

  let shiftId = vacancy.shiftId;
  let createdShiftId: string | null = null;
  let usageKey: string | null = null;

  if (!shiftId) {
    const wage = Number.parseInt(String(formData.get('hourly_wage') ?? ''), 10);
    if (!Number.isFinite(wage) || wage < MIN_HOURLY_WAGE_2026) fail(source, '시급은 2026년 최저시급 이상이어야 해요.');
    const estimatedPay = calcEstimatedShiftPay(vacancy.startTime, vacancy.endTime, wage);
    if (estimatedPay == null) fail(source, '근무 시간을 확인해 주세요.');
    const description = String(formData.get('description') ?? '').trim() || vacancy.description;
    let replacement: { required_credentials?: unknown } | null = null;
    if (source.mode === 'replace') {
      const { data } = await sb.from('shifts').select('required_credentials').eq('id', source.shiftId).maybeSingle();
      replacement = data;
    }
    const { data: created, error } = await sb.from('shifts').insert({
      facility_id: context.facilityId, required_role: vacancy.role,
      shift_date: vacancy.date, start_time: vacancy.startTime, end_time: vacancy.endTime,
      hourly_wage: wage, estimated_total_pay: estimatedPay, description, department: vacancy.department,
      notes: `결원 · ${vacancy.cause}`, audience: makePublic ? 'public' : 'targeted', invited_worker_id: null,
      posted_by: context.user.id,
      ...(source.mode === 'replace' ? { replacement_for_shift_id: source.shiftId, is_replacement: true, required_credentials: replacement?.required_credentials } : {}),
    }).select('id').single();
    if (error || !created) fail(source, '결원 근무를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    shiftId = created.id as string;
    createdShiftId = shiftId;
  } else if (makePublic && vacancy.audience === 'targeted') {
    await sb.from('shifts').update({ audience: 'public', updated_at: new Date().toISOString() }).eq('id', shiftId).eq('facility_id', context.facilityId);
  }

  // 공개 공고로 여는 순간에만 공고 한도를 쓴다 (요청받은 사람만 보는 근무는 공고가 아니다)
  const openingPublic = makePublic && vacancy.audience !== 'public';
  if (openingPublic) {
    usageKey = `job_posting:${context.facilityId}:${shiftId}`;
    try {
      await consumePlanUsage(sb, context.facilityId, 'job_posting_slot', 1, usageKey);
    } catch (error) {
      if (createdShiftId) await sb.from('shifts').delete().eq('id', createdShiftId).eq('facility_id', context.facilityId);
      else await sb.from('shifts').update({ audience: 'targeted' }).eq('id', shiftId).eq('facility_id', context.facilityId);
      await releasePlanUsage(sb, usageKey);
      fail(source, error instanceof Error ? error.message : '요금제 공고 한도를 확인해 주세요.');
    }
  }

  let sent = 0;
  let skipped = 0;
  if (selected.length) {
    const { data, error } = await user.rpc('invite_to_vacancy', { p_shift_id: shiftId, p_worker_ids: selected });
    if (error) {
      if (createdShiftId && !makePublic) await sb.from('shifts').delete().eq('id', createdShiftId).eq('facility_id', context.facilityId);
      fail(source, error.message || '요청을 보내지 못했어요.');
    }
    sent = Number((data as any)?.sent ?? 0);
    skipped = Number((data as any)?.skipped ?? 0);
  }

  if (openingPublic) {
    // 근처 같은 직군 근무자에게 새 공고 알림 — 이미 요청받은 사람은 중복으로 보내지 않는다
    const { data: recipients } = await sb.rpc('get_shift_notification_recipients', { p_shift_id: shiftId });
    const { data: invitedRows } = await sb.from('shift_applications').select('workers(auth_user_id)').eq('shift_id', shiftId).eq('status', 'invited');
    const invitedAuth = new Set(((invitedRows ?? []) as any[]).map((row) => (Array.isArray(row.workers) ? row.workers[0] : row.workers)?.auth_user_id));
    const rows = ((recipients ?? []) as Array<{ auth_user_id: string | null }>)
      .filter((row) => row.auth_user_id && !invitedAuth.has(row.auth_user_id))
      .map((row) => ({
        worker_auth_user_id: row.auth_user_id, event_type: 'shift.created',
        dedupe_key: `shift.created:${shiftId}:${row.auth_user_id}`,
        title: `${vacancy.department ?? '사업장'} 결원 근무가 열렸어요`,
        body: `${vacancy.date} ${vacancy.startTime}~${vacancy.endTime} · 조건을 확인해 보세요.`,
        data: { type: 'new_shift', shiftId, url: '/shifts' },
      }));
    if (rows.length) await sb.from('notification_outbox').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  }

  await nudgeNotificationDispatch();
  revalidatePath('/operations');
  revalidatePath('/shifts');
  revalidatePath('/applications');
  revalidatePath('/');
  redirect(`/vacancy?shift=${shiftId}&sent=${sent}&skipped=${skipped}${openingPublic ? '&public=1' : ''}`);
}
