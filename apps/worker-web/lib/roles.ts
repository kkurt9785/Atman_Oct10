// 'care_worker'·'other' 는 2026-09-16에 추가됐다. 사업장이 초대한 직원이 근태만 쓰려는데
// 간호·약국 4개 직군 중에 고를 게 없어 가입 자체가 막혔기 때문이다.
// DB 쪽 제약은 workers_role_check (20260916180000_attendance_only_onboarding.sql).
export type WorkerRole = 'rn' | 'na' | 'pharmacist' | 'pharmacy_staff' | 'care_worker' | 'other';
export type ShiftRole = WorkerRole | 'any';

// 면허·자격 서류를 받아야 하는 직군. 나머지는 자격 확인을 사업장이 한다.
export const LICENSED_ROLES: readonly WorkerRole[] = ['pharmacist', 'pharmacy_staff'];

export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = {
  rn: '간호사 (RN)',
  na: '간호조무사 (NA)',
  pharmacist: '약사',
  pharmacy_staff: '약국 전산·사무직',
  care_worker: '요양보호사',
  other: '기타 직군',
};

export const SHIFT_ROLE_LABEL: Record<ShiftRole, string> = {
  ...WORKER_ROLE_LABEL,
  any: '자격 무관',
};
