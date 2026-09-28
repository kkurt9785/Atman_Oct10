import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';

// 근무 건(프로젝트) 읽기 모델. 사장님은 사람이 아니라 "이번 주 근무"를 먼저 본다.
export type GigProjectParticipant = {
  assignmentId: string; staffId: string; name: string; workerLinked: boolean; invitePending: boolean; inviteToken: string | null;
  todayStatus: string | null; checkInAt: string | null; checkOutAt: string | null;
};
export type GigProject = {
  id: string; title: string; startsOn: string; endsOn: string; workWeekdays: number[];
  startTime: string; endTime: string; breakMinutes: number; payBasis: 'hourly' | 'daily'; payRate: number | null;
  headcount: number; note: string | null; status: 'active' | 'completed' | 'cancelled';
  participants: GigProjectParticipant[];
};
export type GigCandidate = { staffId: string; name: string; workerLinked: boolean };

export const WEEKDAY_LABEL = ['', '월', '화', '수', '목', '금', '토', '일'];
export function weekdayText(days: number[]) {
  const sorted = [...new Set(days.map(Number))].filter((day) => day >= 1 && day <= 7).sort();
  if (sorted.length === 7) return '매일';
  if (sorted.join() === '1,2,3,4,5') return '평일';
  if (sorted.join() === '6,7') return '주말';
  return sorted.map((day) => WEEKDAY_LABEL[day]).join('·');
}
export function projectScheduleText(project: Pick<GigProject, 'startsOn' | 'endsOn' | 'workWeekdays' | 'startTime' | 'endTime'>) {
  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const range = project.startsOn === project.endsOn ? `${md(project.startsOn)}(${WEEKDAY_LABEL[new Date(`${project.startsOn}T00:00:00Z`).getUTCDay() || 7]})` : `${md(project.startsOn)}~${md(project.endsOn)} ${weekdayText(project.workWeekdays)}`;
  return `${range} · ${project.startTime.slice(0, 5)}–${project.endTime.slice(0, 5)}`;
}
export function projectRunsOn(project: Pick<GigProject, 'startsOn' | 'endsOn' | 'workWeekdays' | 'status'>, date: string) {
  if (project.status === 'cancelled') return false;
  if (date < project.startsOn || date > project.endsOn) return false;
  return project.workWeekdays.map(Number).includes(new Date(`${date}T00:00:00Z`).getUTCDay() || 7);
}

type ProjectRow = {
  id: string; title: string; starts_on: string; ends_on: string; work_weekdays: number[]; start_time: string; end_time: string;
  break_minutes: number; pay_basis: string; pay_rate: number | null; headcount: number; note: string | null; status: string;
};

async function hydrate(sb: NonNullable<ReturnType<typeof adminClient>>, facilityId: string, rows: ProjectRow[]): Promise<GigProject[]> {
  if (rows.length === 0) return [];
  const projectIds = rows.map((row) => row.id);
  const today = todayKST();
  const { data: assignments, error } = await sb.from('gig_assignments')
    .select('id,project_id,staff_id,facility_staff!inner(id,name,worker_id,status)')
    .in('project_id', projectIds).neq('status', 'cancelled');
  if (error) throw new Error('근무 참여자를 불러오지 못했어요.');
  const staffIds = [...new Set((assignments ?? []).map((row) => row.staff_id as string))];
  const [{ data: invites }, { data: attendances }] = staffIds.length ? await Promise.all([
    sb.from('facility_staff_invites').select('staff_id,token').eq('facility_id', facilityId).eq('status', 'pending').gt('expires_at', new Date().toISOString()).in('staff_id', staffIds),
    sb.from('staff_attendances').select('staff_id,status,check_in_at,check_out_at').eq('facility_id', facilityId).eq('work_date', today).in('staff_id', staffIds),
  ]) : [{ data: [] }, { data: [] }];
  const inviteBy = new Map((invites ?? []).map((row) => [row.staff_id as string, row.token as string]));
  const attendanceBy = new Map((attendances ?? []).map((row) => [row.staff_id as string, row]));
  const participantsBy = new Map<string, GigProjectParticipant[]>();
  for (const row of assignments ?? []) {
    const staff = (Array.isArray(row.facility_staff) ? row.facility_staff[0] : row.facility_staff) as { id: string; name: string; worker_id: string | null; status: string } | null;
    if (!staff || staff.status === 'ended') continue;
    const attendance = attendanceBy.get(staff.id);
    (participantsBy.get(row.project_id as string) ?? participantsBy.set(row.project_id as string, []).get(row.project_id as string)!).push({
      assignmentId: row.id as string, staffId: staff.id, name: staff.name, workerLinked: Boolean(staff.worker_id),
      invitePending: inviteBy.has(staff.id), inviteToken: inviteBy.get(staff.id) ?? null,
      todayStatus: attendance?.status ?? null, checkInAt: attendance?.check_in_at ?? null, checkOutAt: attendance?.check_out_at ?? null,
    });
  }
  return rows.map((row) => ({
    id: row.id, title: row.title, startsOn: row.starts_on, endsOn: row.ends_on, workWeekdays: (row.work_weekdays ?? []).map(Number),
    startTime: row.start_time, endTime: row.end_time, breakMinutes: row.break_minutes, payBasis: row.pay_basis as GigProject['payBasis'],
    payRate: row.pay_rate == null ? null : Number(row.pay_rate), headcount: row.headcount, note: row.note, status: row.status as GigProject['status'],
    participants: (participantsBy.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// 진행 중·다가오는 근무 건. includeClosed 면 끝난 것도 최근 순으로 같이 준다.
export async function listGigProjects(includeClosed = false): Promise<GigProject[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  let query = sb.from('gig_projects').select('*').eq('facility_id', facilityId);
  query = includeClosed ? query.neq('status', 'cancelled') : query.eq('status', 'active').gte('ends_on', todayKST());
  const { data, error } = await query.order('starts_on').order('start_time').limit(100);
  if (error) throw new Error('근무 건을 불러오지 못했어요.');
  return hydrate(sb, facilityId, (data ?? []) as ProjectRow[]);
}

export async function getGigProject(projectId: string): Promise<GigProject | null> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return null;
  const { data } = await sb.from('gig_projects').select('*').eq('id', projectId).eq('facility_id', facilityId).maybeSingle();
  if (!data) return null;
  return (await hydrate(sb, facilityId, [data as ProjectRow]))[0] ?? null;
}

// 이 근무 건에 아직 안 들어간, 이 사업장의 긱 근무자
export async function listGigCandidates(projectId: string): Promise<GigCandidate[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const [{ data: staff }, { data: taken }] = await Promise.all([
    sb.from('facility_staff').select('id,name,worker_id').eq('facility_id', facilityId).eq('worker_kind', 'gig').neq('status', 'ended').order('name'),
    sb.from('gig_assignments').select('staff_id').eq('project_id', projectId).neq('status', 'cancelled'),
  ]);
  const takenSet = new Set((taken ?? []).map((row) => row.staff_id as string));
  return (staff ?? []).filter((row) => !takenSet.has(row.id as string)).map((row) => ({ staffId: row.id as string, name: row.name as string, workerLinked: Boolean(row.worker_id) }));
}
