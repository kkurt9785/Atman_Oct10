'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '../admin-auth';
import { adminClient } from '../supabase';
import { requireStaffCapacity } from '../billing-gates';

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
  if (payRate !== null && (!Number.isInteger(payRate) || payRate <= 0)) throw new Error('시급을 확인해 주세요.');
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 200) throw new Error('필요 인원을 확인해 주세요.');
  if (startsOn === endsOn) weekdays = [new Date(`${startsOn}T00:00:00Z`).getUTCDay() || 7];
  if (weekdays.length === 0) throw new Error('반복 요일을 하나 이상 선택해 주세요.');
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

function touch(projectId?: string) {
  revalidatePath('/'); revalidatePath('/gig-work'); revalidatePath('/timesheet'); revalidatePath('/staff');
  if (projectId) revalidatePath(`/gig-work/${projectId}`);
}

export async function createGigProjectAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
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
  await requireProject(sb, context.facilityId, projectId);
  const schedule = readSchedule(form);
  const { error } = await sb.from('gig_projects').update({ ...schedule, updated_at: new Date().toISOString() }).eq('id', projectId).eq('facility_id', context.facilityId);
  if (error) throw new Error('근무 건을 수정하지 못했어요.');
  // 참여자 계약 범위도 같이 넓힌다
  const { data: members } = await sb.from('gig_assignments').select('staff_id').eq('project_id', projectId).neq('status', 'cancelled');
  for (const row of members ?? []) await widenStaffSchedule(sb, row.staff_id as string, schedule);
  touch(projectId);
}

export async function cancelGigProjectAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
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
  touch(projectId);
  return { added: valid.length };
}

// 새 사람을 이 근무 건으로 바로 초대한다 (근무자 등록 + 초대 링크 + 참여)
export async function inviteGigParticipantAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const projectId = text(form, 'project_id');
  const project = await requireProject(sb, context.facilityId, projectId);
  const name = text(form, 'name');
  const phone = text(form, 'phone') || null;
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
  touch(projectId);
  return { staffId: created.id as string, inviteToken, linked: false };
}

export async function removeGigParticipantAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
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

export type GigProjectActionKind = 'create' | 'update' | 'cancel' | 'add_participants' | 'invite_participant' | 'remove_participant';
export async function runGigProjectAction(kind: GigProjectActionKind, form: FormData): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  try {
    const actions: Record<GigProjectActionKind, (data: FormData) => Promise<unknown>> = {
      create: createGigProjectAction, update: updateGigProjectAction, cancel: cancelGigProjectAction,
      add_participants: addGigParticipantsAction, invite_participant: inviteGigParticipantAction, remove_participant: removeGigParticipantAction,
    };
    const data = await actions[kind](form);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '처리하지 못했어요. 다시 시도해 주세요.' };
  }
}
