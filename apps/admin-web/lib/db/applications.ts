import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

export type Applicant = {
  applicationId: string;
  workerId: string;
  name: string;
  role: 'rn' | 'na';
  verificationStatus: string;
  distanceMeters: number | null;
  matchScore: number | null;
  appliedAt: string;
  licenseNumber: string | null;
  licensePhotoUrl: string | null;
  experienceYears: string | null;
  lastWorkplace: string | null;
  departmentTags: string[] | null;
  isDemo: boolean;
};

export type ApplicationGroup = {
  shiftId: string;
  shiftDate: string;   // 'YYYY-MM-DD'
  startTime: string;   // 'HH:MM:SS'
  endTime: string;
  department: string | null;
  requiredRole: string;
  shiftStatus: string;
  estimatedTotalPay: number;
  applicants: Applicant[];
};

export async function getPendingApplications(): Promise<ApplicationGroup[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];

  // 1. 이 시설의 시프트 ID 목록
  const { data: shiftRows } = await sb
    .from('shifts')
    .select('id, shift_date, start_time, end_time, department, required_role, status, estimated_total_pay')
    .eq('facility_id', facilityId)
    .eq('status', 'open');

  if (!shiftRows?.length) return [];
  const shiftIds = shiftRows.map((s: any) => s.id);
  const shiftMap = Object.fromEntries(shiftRows.map((s: any) => [s.id, s]));

  // 2. 해당 시프트의 대기 중 지원자
  const { data: apps } = await sb
    .from('shift_applications')
    .select('id, shift_id, worker_id, distance_meters, match_score, applied_at, workers ( name, role, verification_status, license_number, license_photo_url, experience_years, last_workplace, department_tags, is_demo )')
    .eq('status', 'applied')
    .in('shift_id', shiftIds)
    .order('applied_at', { ascending: true });

  if (!apps?.length) return [];

  const groups = new Map<string, ApplicationGroup>();
  for (const row of apps as any[]) {
    const shift = shiftMap[row.shift_id];
    if (!shift) continue;
    if (!groups.has(row.shift_id)) {
      groups.set(row.shift_id, {
        shiftId: shift.id,
        shiftDate: shift.shift_date,
        startTime: shift.start_time,
        endTime: shift.end_time,
        department: shift.department,
        requiredRole: shift.required_role,
        shiftStatus: shift.status,
        estimatedTotalPay: shift.estimated_total_pay,
        applicants: [],
      });
    }
    groups.get(row.shift_id)!.applicants.push({
      applicationId: row.id,
      workerId: row.worker_id,
      name: row.workers.name,
      role: row.workers.role,
      verificationStatus: row.workers.verification_status,
      distanceMeters: row.distance_meters,
      matchScore: row.match_score,
      appliedAt: row.applied_at,
      licenseNumber: row.workers.license_number ?? null,
      licensePhotoUrl: row.workers.license_photo_url ?? null,
      experienceYears: row.workers.experience_years ?? null,
      lastWorkplace: row.workers.last_workplace ?? null,
      departmentTags: row.workers.department_tags ?? null,
      isDemo: row.workers.is_demo === true,
    });
  }

  return Array.from(groups.values()).sort(
    (a, b) => a.shiftDate.localeCompare(b.shiftDate)
  );
}

export async function getPendingCount(): Promise<number> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return 0;

  const { data: shiftRows } = await sb
    .from('shifts')
    .select('id')
    .eq('facility_id', facilityId)
    .eq('status', 'open');

  if (!shiftRows?.length) return 0;

  const { count } = await sb
    .from('shift_applications')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'applied')
    .in('shift_id', shiftRows.map((s: any) => s.id));

  return count ?? 0;
}
