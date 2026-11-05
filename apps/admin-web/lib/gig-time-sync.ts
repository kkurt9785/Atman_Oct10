// 근무 건 시간 ↔ 근무자 기본 시간(facility_staff.default_*) 맞추기 판단. DB 없이 시험할 수 있게 순수 함수로 둔다.
// 출퇴근 RPC 는 근무자 기본 시간으로 출근 가능 시간을 판정하므로, 근무 건 시간을 고치거나 다른 근무 건에 넣을 때 맞춘다.
// - 진행 중인 다른 근무 건(취소 안 됨·종료일 안 지남)과 시간이 다르면 맞추지 않는다(otherProject) — 어느 시간을 따를지 몰라서.
// - 근무 건 시간 수정(previous 있음)일 땐 기본 시간이 예전 근무 건 시간과 같던 사람만 맞춘다. 따로 정한 시간은 지킨다(custom).

export type ClockTimes = { start_time: string; end_time: string };
export type StaffTimes = { id: string; name: string; default_start_time: string | null; default_end_time: string | null };
export type OtherAssignment = { staff_id: string; project_id: string };
export type OtherProject = { id: string; start_time: string; end_time: string };

export const hm = (value: unknown) => String(value ?? '').slice(0, 5);
const same = (a: { start: unknown; end: unknown }, b: ClockTimes) => hm(a.start) === hm(b.start_time) && hm(a.end) === hm(b.end_time);

export function planStaffTimeSync(input: {
  staff: StaffTimes[];
  others: OtherAssignment[];          // 이 근무 건 말고 이 사람들이 들어 있는 배정(취소 제외)
  activeOtherProjects: OtherProject[]; // 그중 진행 중인 근무 건만
  times: ClockTimes;                   // 맞출 시간(이 근무 건의 새 시간)
  previous?: ClockTimes;               // 근무 건 시간 수정일 때 예전 시간
}) {
  const differs = new Set(input.activeOtherProjects.filter((p) => !same({ start: p.start_time, end: p.end_time }, input.times)).map((p) => p.id));
  const ids: string[] = []; const otherProject: string[] = []; const custom: string[] = [];
  for (const row of input.staff) {
    if (input.others.some((o) => o.staff_id === row.id && differs.has(o.project_id))) { otherProject.push(row.name); continue; }
    const current = { start: row.default_start_time, end: row.default_end_time };
    if (input.previous && !same(current, input.previous)) {
      if (!same(current, input.times)) custom.push(row.name);
      continue;
    }
    ids.push(row.id); // 시간이 같아도 넣는다 — 휴게시간만 바뀐 경우도 맞추고, 같은 값 갱신은 해가 없다
  }
  return { ids, otherProject, custom };
}

// 맞추지 못한 사람을 사장님께 한 줄로 알린다. 없으면 undefined.
export function timeSyncNotice(sync: { otherProject: string[]; custom: string[] }, start: string, end: string) {
  const names = (list: string[]) => list.length > 3 ? `${list.slice(0, 3).join(', ')} 외 ${list.length - 3}명` : list.join(', ');
  const parts: string[] = [];
  if (sync.otherProject.length) parts.push(`${names(sync.otherProject)}님은 시간이 다른 근무에도 들어 있어 출근 가능 시간을 그대로 뒀어요`);
  if (sync.custom.length) parts.push(`${names(sync.custom)}님은 따로 정한 근무 시간이 있어 그대로 뒀어요`);
  return parts.length ? `${parts.join(' · ')}. ${hm(start)}~${hm(end)}에 출근하려면 근무자 관리에서 그 사람의 근무 시간을 바꿔 주세요.` : undefined;
}
