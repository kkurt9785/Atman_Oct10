export const FACILITY_COOKIE = 'atman_facility_id';

// 직군 이름 — 화면마다 'RN 간호사'·'간호사 RN'·'정규직 간호사'로 갈려 있던 표기를 하나로 맞춘다
export const ROLE_FULL_LABEL: Record<string, string> = {
  rn: '간호사 (RN)',
  na: '간호조무사 (NA)',
  pharmacist: '약사',
  pharmacy_staff: '약국 전산·사무직',
  any: '자격 무관',
};
