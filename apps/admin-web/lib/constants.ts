export const FACILITY_COOKIE = 'atman_facility_id';

// 직군 이름 — 화면마다 'RN 간호사'·'간호사 RN'·'정규직 간호사'로 갈려 있던 표기를 하나로 맞춘다
export const ROLE_FULL_LABEL: Record<string, string> = {
  rn: '간호사 (RN)',
  na: '간호조무사 (NA)',
  pharmacist: '약사',
  pharmacy_staff: '약국 전산·사무직',
  dental_hygienist: '치과위생사',
  any: '자격 무관',
};

// 직원(facility_staff.role) 직종 — DB facility_staff_role_check 와 같게 유지할 것
export const STAFF_ROLE_LABEL: Record<string, string> = {
  rn: '간호사', na: '간호조무사', dental_hygienist: '치과위생사', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직',
  care_worker: '요양보호사', coordinator: '코디네이터', admin: '행정', other: '기타',
};
export const STAFF_ROLE_KEYS = Object.keys(STAFF_ROLE_LABEL);
// 근무자(workers.role)·공고(shifts.required_role) 직종 이름
export const WORKER_ROLE_LABEL: Record<string, string> = {
  rn: '간호사', na: '간호조무사', dental_hygienist: '치과위생사', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직',
  care_worker: '요양보호사', other: '기타', any: '자격 무관',
};
