// 'care_worker'·'other' 는 2026-09-16에 추가됐다. 사업장이 초대한 직원이 근태만 쓰려는데
// 간호·약국 4개 직군 중에 고를 게 없어 가입 자체가 막혔기 때문이다.
// DB 쪽 제약은 workers_role_check (20260916180000_attendance_only_onboarding.sql).
// 'dental_hygienist' 는 2026-11-10 치과 베타 준비로 추가됐다 — 치과 직원이 '기타 직군'으로만 보였기 때문이다.
// DB 제약(workers·facility_staff·shifts 의 role CHECK)은 20261110100000 마이그레이션이 맡는다. 그 전에 이 직군으로 가입하면 서버가 거부한다.
export type WorkerRole = 'rn' | 'na' | 'pharmacist' | 'pharmacy_staff' | 'care_worker' | 'dental_hygienist' | 'other';
export type ShiftRole = WorkerRole | 'any';

// 면허·자격 서류를 받아야 하는 직군. 나머지는 자격 확인을 사업장이 한다.
export const LICENSED_ROLES: readonly WorkerRole[] = ['pharmacist', 'pharmacy_staff'];

export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = {
  rn: '간호사',
  na: '간호조무사',
  pharmacist: '약사',
  pharmacy_staff: '약국 전산·사무직',
  care_worker: '요양보호사',
  dental_hygienist: '치과위생사',
  other: '기타 직군',
};

export const SHIFT_ROLE_LABEL: Record<ShiftRole, string> = {
  ...WORKER_ROLE_LABEL,
  any: '직군 무관',
};

// 사업장이 직원 명부(facility_staff.role)에 적은 직종. 근무자 직군에 없는 값(코디네이터·행정)도 있다.
export const STAFF_ROLE_LABEL: Record<string, string> = {
  ...WORKER_ROLE_LABEL,
  coordinator: '코디네이터',
  admin: '행정',
  other: '기타 직군',
};

// 내 정보에 보일 직군 이름. 초대로 간편 가입한 직원은 근무자 직군이 'other' 로 고정이라
// 사업장이 명부에 적어 둔 직종이 더 정확하다 — 그 값이 있으면 그것을 쓴다.
export function displayRoleLabel(workerRole: string | null | undefined, staffRole?: string | null) {
  if ((!workerRole || workerRole === 'other') && staffRole && staffRole !== 'other' && STAFF_ROLE_LABEL[staffRole]) {
    return STAFF_ROLE_LABEL[staffRole];
  }
  return workerRole ? WORKER_ROLE_LABEL[workerRole as WorkerRole] ?? '' : '';
}
