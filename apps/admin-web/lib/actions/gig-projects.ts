'use server';

import { assertNotDemoFacility } from '../demo-guard';
import { hourlyWageError, lastWorkDate } from '../pay';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '../admin-auth';
import { adminClient } from '../supabase';
import { getStaffCapacity, requireGigBetaActive, requireStaffCapacity } from '../billing-gates';
import { GIG_INVITE_BATCH_MAX } from '../gig-invite-lines';
import { todayKST } from '../date';
import { countWorkDays } from '../gig-period';
import { hm, planStaffTimeSync, timeSyncNotice } from '../gig-time-sync';

// 근무 건(프로젝트) 관리. 사람이 아니라 근무를 먼저 만들고 여러 명을 넣는다. 급여는 근무 건의 시급이 기준이다.
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function readSchedule(form: FormData) {
  const title = text(form, 'title');
  const startsOn = text(form, 'starts_on');
  const endsOn = text(form, 'ends_on') || startsOn;
  const startTime = text(form, 'start_time');
  const endTime = text(form, 'end_time');
  const breakMinutes = Number(text(form, 'break_minutes') || '0');
  const payRateText = text(form, 'pay_rate');
  const payRate = payRateText ? Number(payRateText) : null;
  const headcount = Number(text(form, 'headcount') || '1');
  const note = text(form, 'note') || null;
  let weekdays = form.getAll('work_weekdays').map(Number).filter((day) => day >= 1 && day <= 7);
  if (!title || title.length > 120) throw new Error('근무 이름을 1~120자로 입력해 주세요.');
  if (!DATE.test(startsOn) || !DATE.test(endsOn) || endsOn < startsOn) throw new Error('근무 기간을 확인해 주세요.');
  if (!TIME.test(startTime) || !TIME.test(endTime)) throw new Error('근무 시간을 확인해 주세요.');
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 720) throw new Error('휴게시간을 확인해 주세요.');
  if (payRate !== null) {
    const wageError = hourlyWageError(payRate, startsOn, lastWorkDate(endsOn, startTime, endTime));
    if (wageError) throw new Error(wageError);
  }
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 200) throw new Error('필요 인원을 확인해 주세요.');
  if (startsOn === endsOn) weekdays = [new Date(`${startsOn}T00:00:00Z`).getUTCDay() || 7];
  if (weekdays.length === 0) throw new Error('반복 요일을 하나 이상 선택해 주세요.');
  if (countWorkDays(startsOn, endsOn, weekdays) === 0) throw new Error('고른 요일이 근무 기간 안에 없어요. 기간에 든 요일을 골라 주세요.');
  return { title, starts_on: startsOn, ends_on: endsOn, work_weekdays: [...new Set(weekdays)].sort(), start_time: startTime, end_time: endTime, break_minutes: breakMinutes, pay_basis: 'hourly', pay_rate: payRate, headcount, note };
}

async function requireProject(sb: NonNullable<ReturnType<typeof adminClient>>, facilityId: string, projectId: string) {
  const { data } = await sb.from('gig_projects').select('id,title,starts_on,ends_on,work_weekdays,start_time,end_time,break_minutes,pay_basis,pay_rate,status')
    .eq('id', projectId).eq('facility_id', facilityId).maybeSingle();
  if (!data) throw new Error('근무 건을 찾을 수 없어요.');
  if (data.status === 'cancelled') throw new Error('취소된 근무 건이에요.');
  return data;
}

// 근무자의 계약 기간·요일이 근무 건을 덮도록 넓힌다 — 출퇴근 RPC 의 NOT_SCHEDULED 검사가 근무자 행을 본다.
async function widenStaffSchedule(sb: NonNullable<ReturnType<typeof adminClient>>, staffId: string, project: { starts_on: string; ends_on: string; work_weekdays: number[] }) {
  const { data: staff } = await sb.from('facility_staff').select('contract_start,contract_end,work_weekdays').eq('id', staffId).maybeSingle();
  if (!staff) return;
  const days = [...new Set([...(staff.work_weekdays ?? []).map(Number), ...project.work_weekdays.map(Number)])].sort();
  await sb.from('facility_staff').update({
    contract_start: !staff.contract_start || project.starts_on < staff.contract_start ? project.starts_on : staff.contract_start,
    contract_end: !staff.contract_end || project.ends_on > staff.contract_end ? project.ends_on : staff.contract_end,
    work_weekdays: days, updated_at: new Date().toISOString(),
  }).eq('id', staffId);
}

// 출퇴근 RPC(record_unified_attendance)는 근무 건이 아니라 근무자 기본 시간(facility_staff.default_*)으로 출근 가능 시간을 판정한다.
// 근무 건 시간을 고치거나 기존 근무자를 다른 근무 건에 넣을 때 기본 시간을 그 근무 건에 맞춘다(2026-11-05, 서버 판정 개선 전 임시).
// 누구를 맞출지는 lib/gig-time-sync.ts planStaffTimeSync 가 정한다.
type ProjectTimes = { start_time: string; end_time: string; break_minutes: number };
async function syncStaffDefaultTimes(
  sb: NonNullable<ReturnType<typeof adminClient>>, facilityId: string, projectId: string, staffIds: string[],
  times: ProjectTimes, previous?: ProjectTimes,
): Promise<{ synced: number; otherProject: string[]; custom: string[] }> {
  if (staffIds.length === 0) return { synced: 0, otherProject: [], custom: [] };
  const [{ data: staff }, { data: others }] = await Promise.all([
    sb.from('facility_staff').select('id,name,default_start_time,default_end_time').eq('facility_id', facilityId).eq('worker_kind', 'gig').in('id', staffIds),
    sb.from('gig_assignments').select('staff_id,project_id').eq('facility_id', facilityId).in('staff_id', staffIds).neq('project_id', projectId).neq('status', 'cancelled'),
  ]);
  const otherIds = [...new Set((others ?? []).map((row) => row.project_id as string).filter(Boolean))];
  const { data: activeOther } = otherIds.length
    ? await sb.from('gig_projects').select('id,start_time,end_time').in('id', otherIds).neq('status', 'cancelled').gte('ends_on', todayKST())
    : { data: [] };
  const plan = planStaffTimeSync({
    staff: (staff ?? []).map((row) => ({ id: row.id as string, name: String(row.name ?? '근무자'), default_start_time: row.default_start_time as string | null, default_end_time: row.default_end_time as string | null })),
    others: (others ?? []).filter((row) => row.project_id).map((row) => ({ staff_id: row.staff_id as string, project_id: row.project_id as string })),
    activeOtherProjects: (activeOther ?? []).map((row) => ({ id: row.id as string, start_time: row.start_time as string, end_time: row.end_time as string })),
    times, previous,
  });
  if (plan.ids.length) {
    const { error } = await sb.from('facility_staff').update({
      default_start_time: times.start_time, default_end_time: times.end_time, default_break_minutes: times.break_minutes, updated_at: new Date().toISOString(),
    }).eq('facility_id', facilityId).in('id', plan.ids);
    if (error) throw new Error('근무자 출근 시간을 맞추지 못했어요. 다시 시도해 주세요.');
  }
  return { synced: plan.ids.length, otherProject: plan.otherProject, custom: plan.custom };
}

function touch(projectId?: string) {
  revalidatePath('/'); revalidatePath('/gig-work'); revalidatePath('/timesheet'); revalidatePath('/staff');
  if (projectId) revalidatePath(`/gig-work/${projectId}`);
}

export async function createGigProjectAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  // 무료 베타 한 달이 끝난 현장은 새 근무를 만들 수 없다(기록은 보관, 2026-11-05 결정)
  await requireGigBetaActive(sb, context.facilityId);
  const schedule = readSchedule(form);
  const { data, error } = await sb.from('gig_projects').insert({ ...schedule, facility_id: context.facilityId, created_by: context.user.id }).select('id').single();
  if (error || !data) throw new Error('근무 건을 만들지 못했어요.');
  touch(data.id);
  return { projectId: data.id as string };
}

export async function updateGigProjectAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const projectId = text(form, 'project_id');
  const before = await requireProject(sb, context.facilityId, projectId);
  const schedule = readSchedule(form);
  const { error } = await sb.from('gig_projects').update({ ...schedule, updated_at: new Date().toISOString() }).eq('id', projectId).eq('facility_id', context.facilityId);
  if (error) throw new Error('근무 건을 수정하지 못했어요.');
  // 참여자 계약 범위도 같이 넓힌다
  const { data: members } = await sb.from('gig_assignments').select('staff_id').eq('project_id', projectId).neq('status', 'cancelled');
  for (const row of members ?? []) await widenStaffSchedule(sb, row.staff_id as string, schedule);
  // 근무 시간이 바뀌었으면 참여자 출근 가능 시간도 따라가게 한다(예전 근무 건 시간을 그대로 쓰던 사람만)
  let notice: string | undefined;
  if (hm(before.start_time) !== hm(schedule.start_time) || hm(before.end_time) !== hm(schedule.end_time) || Number(before.break_minutes) !== schedule.break_minutes) {
    const sync = await syncStaffDefaultTimes(sb, context.facilityId, projectId, (members ?? []).map((row) => row.staff_id as string),
      schedule, { start_time: before.start_time as string, end_time: before.end_time as string, break_minutes: Number(before.break_minutes) });
    notice = timeSyncNotice(sync, schedule.start_time, schedule.end_time);
  }
  touch(projectId);
  return { notice };
}

export async function cancelGigProjectAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  await assertNotDemoFacility(context.facilityId);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const projectId = text(form, 'project_id');
  await requireProject(sb, context.facilityId, projectId);
  const { count } = await sb.from('staff_attendances').select('id', { count: 'exact', head: true })
    .in('gig_assignment_id', (await sb.from('gig_assignments').select('id').eq('project_id', projectId)).data?.map((row) => row.id as string) ?? ['00000000-0000-0000-0000-000000000000'])
    .in('status', ['working', 'late', 'checkout_pending']);
  if ((count ?? 0) > 0) throw new Error('출근 중이거나 승인 대기인 근태가 있어요. 먼저 확정한 뒤 취소해 주세요.');
  const { error } = await sb.from('gig_projects').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', projectId).eq('facility_id', context.facilityId);
  if (error) throw new Error('근무 건을 취소하지 못했어요.');
  touch(projectId);
}

// 이미 등록된 긱 근무자들을 근무 건에 넣는다
export async function addGigParticipantsAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const projectId = text(form, 'project_id');
  await requireGigBetaActive(sb, context.facilityId);
  const project = await requireProject(sb, context.facilityId, projectId);
  const staffIds = [...new Set(form.getAll('staff_ids').map(String).filter(Boolean))];
  if (staffIds.length === 0) throw new Error('추가할 근무자를 골라 주세요.');
  const { data: staff } = await sb.from('facility_staff').select('id,worker_kind,status').eq('facility_id', context.facilityId).in('id', staffIds);
  const valid = (staff ?? []).filter((row) => row.worker_kind === 'gig' && row.status !== 'ended').map((row) => row.id as string);
  if (valid.length === 0) throw new Error('단기·긱 근무자만 근무 건에 넣을 수 있어요.');
  const { error } = await sb.from('gig_assignments').upsert(
    valid.map((staffId) => ({ facility_id: context.facilityId, staff_id: staffId, project_id: projectId, created_by: context.user.id })),
    { onConflict: 'project_id,staff_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`근무자를 추가하지 못했어요: ${error.message}`);
  for (const staffId of valid) await widenStaffSchedule(sb, staffId, { starts_on: project.starts_on, ends_on: project.ends_on, work_weekdays: (project.work_weekdays ?? []).map(Number) });
  // 이 근무 건 시간에 출근할 수 있게 기본 시간을 맞춘다(시간이 다른 진행 중 근무가 또 있으면 그대로 두고 알린다)
  const sync = await syncStaffDefaultTimes(sb, context.facilityId, projectId, valid,
    { start_time: project.start_time as string, end_time: project.end_time as string, break_minutes: Number(project.break_minutes ?? 0) });
  touch(projectId);
  return { added: valid.length, notice: timeSyncNotice(sync, project.start_time as string, project.end_time as string) };
}

// 새 사람을 이 근무 건으로 바로 초대한다 (근무자 등록 + 초대 링크 + 참여)
export async function inviteGigParticipantAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const projectId = text(form, 'project_id');
  const project = await requireProject(sb, context.facilityId, projectId);
  const result = await registerGigInvite(sb, context, projectId, project, text(form, 'name'), text(form, 'phone'));
  touch(projectId);
  return result;
}

export type GigInviteResult = { name: string; ok: boolean; inviteToken?: string; error?: string; overCapacity?: boolean };
export type GigInviteBatch = { results: GigInviteResult[]; limit: number };

// 새 사람 여러 명을 한 번에 이 근무 건으로 초대한다. 사람마다 한 명 초대와 같은 등록·인원 한도 검사(registerGigInvite)를 순서대로 거치고,
// 한 명이 실패해도 나머지는 등록한 뒤 사람별 결과를 돌려준다. 한도가 찬 뒤의 사람은 시도하지 않고 overCapacity 로 알려 준다.
export async function inviteGigParticipantsAction(form: FormData): Promise<GigInviteBatch> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const projectId = text(form, 'project_id');
  const project = await requireProject(sb, context.facilityId, projectId);
  let people: Array<{ name: string; phone: string }>;
  try { people = JSON.parse(text(form, 'people')); } catch { throw new Error('초대할 사람 목록을 읽지 못했어요. 새로고침해 주세요.'); }
  if (!Array.isArray(people) || people.length === 0) throw new Error('초대할 사람의 이름을 입력해 주세요.');
  if (people.length > GIG_INVITE_BATCH_MAX) throw new Error(`한 번에 ${GIG_INVITE_BATCH_MAX}명까지 초대할 수 있어요.`);
  if (people.some((person) => typeof person?.name !== 'string' || typeof (person.phone ?? '') !== 'string')) throw new Error('초대할 사람 목록이 올바르지 않아요. 새로고침해 주세요.');
  const capacity = await getStaffCapacity(sb, context.facilityId);
  // 자리 수가 아닌 이유(무료 베타 기간 종료 등)로 막힌 현장은 기존 게이트 문구 그대로 전체를 거절한다
  if ('betaLocked' in capacity && capacity.betaLocked) await requireStaffCapacity(sb, context.facilityId);
  let left = capacity.remaining;
  const results: GigInviteResult[] = [];
  for (const person of people) { // 순서대로: 사람마다 한도를 다시 확인한다
    const name = person.name.trim();
    if (left <= 0) { results.push({ name, ok: false, overCapacity: true }); continue; }
    try {
      const { inviteToken } = await registerGigInvite(sb, context, projectId, project, name, String(person.phone ?? '').trim());
      results.push({ name, ok: true, inviteToken });
      left -= 1;
    } catch (error) {
      results.push({ name, ok: false, error: error instanceof Error ? error.message : '등록하지 못했어요.' });
      // 등록 중간에 실패해도 자리를 차지했을 수 있어 실제 남은 자리를 다시 읽는다
      left = await getStaffCapacity(sb, context.facilityId).then((now) => now.remaining, () => left);
    }
  }
  touch(projectId); // 실패한 사람도 등록까지는 됐을 수 있어 목록을 항상 새로 그린다
  return { results, limit: capacity.limit };
}

// 한 사람 등록 + 참여 + 일회용 초대. 인원 한도는 사람마다 여기서 확인한다(일괄 초대도 이 검사를 건너뛰지 않는다).
async function registerGigInvite(
  sb: NonNullable<ReturnType<typeof adminClient>>,
  context: Awaited<ReturnType<typeof requireAdminContext>>,
  projectId: string,
  project: Awaited<ReturnType<typeof requireProject>>,
  name: string,
  phoneText: string,
) {
  const phone = phoneText || null;
  const normalizedPhone = phone?.replace(/\D/g, '') ?? '';
  if (!name || name.length > 80) throw new Error('이름을 확인해 주세요.');
  if (phone && !/^010\d{8}$/.test(normalizedPhone)) throw new Error('휴대전화 번호를 정확히 입력해 주세요.');
  await requireStaffCapacity(sb, context.facilityId);
  const { data: created, error } = await sb.from('facility_staff').insert({
    facility_id: context.facilityId, worker_id: null, name, phone, worker_kind: 'gig',
    role: 'other', department: project.title, source: 'direct',
    engagement_type: project.starts_on === project.ends_on ? 'daily' : 'temporary',
    contract_start: project.starts_on, contract_end: project.ends_on, work_weekdays: (project.work_weekdays ?? []).map(Number),
    default_start_time: project.start_time, default_end_time: project.end_time, default_break_minutes: project.break_minutes,
    pay_basis: project.pay_rate ? project.pay_basis : null, pay_rate: project.pay_rate ?? null, created_by: context.user.id,
  }).select('id').single();
  if (error || !created) throw new Error('근무자를 등록하지 못했어요.');
  const { error: assignError } = await sb.from('gig_assignments').insert({ facility_id: context.facilityId, staff_id: created.id, project_id: projectId, created_by: context.user.id });
  if (assignError) throw new Error(`근무 건에 넣지 못했어요: ${assignError.message}`);
  // 전화번호는 관리자가 초대를 전달할 때 참고하는 선택 정보다. 계정 연결은 워커의 명시적 수락으로만 한다.
  const { data: invite, error: inviteError } = await sb.from('facility_staff_invites').insert({
    facility_id: context.facilityId, staff_id: created.id, phone_normalized: normalizedPhone || null, created_by: context.user.id,
  }).select('token').single();
  if (inviteError || !invite?.token) throw new Error('근무자는 등록됐지만 초대 링크를 만들지 못했어요. 근무자 관리에서 다시 발급해 주세요.');
  const inviteToken = invite.token as string;
  return { staffId: created.id as string, inviteToken };
}

export async function removeGigParticipantAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  await assertNotDemoFacility(context.facilityId);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const assignmentId = text(form, 'assignment_id');
  const { data: assignment } = await sb.from('gig_assignments').select('id,project_id,staff_id').eq('id', assignmentId).eq('facility_id', context.facilityId).maybeSingle();
  if (!assignment?.project_id) throw new Error('참여 정보를 찾을 수 없어요.');
  const { count } = await sb.from('staff_attendances').select('id', { count: 'exact', head: true }).eq('gig_assignment_id', assignmentId);
  if ((count ?? 0) > 0) {
    // 근태가 남은 참여는 지우지 않고 취소로 남긴다 — 지급 계산 근거가 사라지면 안 된다
    await sb.from('gig_assignments').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', assignmentId);
  } else {
    await sb.from('gig_assignments').delete().eq('id', assignmentId);
  }
  touch(assignment.project_id as string);
}

export type GigProjectActionKind = 'create' | 'update' | 'cancel' | 'add_participants' | 'invite_participant' | 'invite_participants' | 'remove_participant';
export async function runGigProjectAction(kind: GigProjectActionKind, form: FormData): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  try {
    const actions: Record<GigProjectActionKind, (data: FormData) => Promise<unknown>> = {
      create: createGigProjectAction, update: updateGigProjectAction, cancel: cancelGigProjectAction,
      add_participants: addGigParticipantsAction, invite_participant: inviteGigParticipantAction, invite_participants: inviteGigParticipantsAction, remove_participant: removeGigParticipantAction,
    };
    const data = await actions[kind](form);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '처리하지 못했어요. 다시 시도해 주세요.' };
  }
}
