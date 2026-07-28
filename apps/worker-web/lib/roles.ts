export type WorkerRole = 'rn' | 'na' | 'pharmacist' | 'pharmacy_staff';
export type ShiftRole = WorkerRole | 'any';

export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = {
  rn: '간호사 (RN)',
  na: '간호조무사 (NA)',
  pharmacist: '약사',
  pharmacy_staff: '약국 전산·사무직',
};

export const SHIFT_ROLE_LABEL: Record<ShiftRole, string> = {
  ...WORKER_ROLE_LABEL,
  any: '자격 무관',
};
