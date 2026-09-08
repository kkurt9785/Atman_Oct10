import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { createLicenseSignedUrl } from '../license-storage';

export type Applicant = {
  applicationId: string;
  workerId: string;
  name: string;
  role: 'rn' | 'na' | 'pharmacist' | 'pharmacy_staff';
  verificationStatus: string;
  credentialReviewStatus: string;
  credentialVerificationMethod: string | null;
  credentialConfirmedBy: string | null;
  credentialConfirmedAt: string | null;
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
  const { data: shiftRows, error: shiftError } = await sb
    .from('shifts')
    .select('id, shift_date, start_time, end_time, department, required_role, status, estimated_total_pay')
    .eq('facility_id', facilityId)
    .eq('status', 'open');
  if (shiftError) throw new Error(`모집 공고를 불러오지 못했어요: ${shiftError.message}`);

  if (!shiftRows?.length) return [];
  const shiftIds = shiftRows.map((s: any) => s.id);
  const shiftMap = Object.fromEntries(shiftRows.map((s: any) => [s.id, s]));

  // 2. 해당 시프트의 대기 중 지원자
  const { data: apps, error: applicationError } = await sb
    .from('shift_applications')
    .select('id, shift_id, worker_id, distance_meters, match_score, applied_at, credential_review_status, credential_verification_method, credential_confirmed_by, credential_confirmed_at, workers ( name, role, verification_status, license_number, license_photo_url, experience_years, last_workplace, department_tags, is_demo )')
    .eq('status', 'applied')
    .in('shift_id', shiftIds)
    .order('applied_at', { ascending: true });
  if (applicationError) throw new Error(`지원 현황을 불러오지 못했어요: ${applicationError.message}`);

  if (!apps?.length) return [];

  const groups = new Map<string, ApplicationGroup>();
  for (const row of apps as any[]) {
    const signedLicenseUrl = await createLicenseSignedUrl(sb, row.workers?.license_photo_url, 300);
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
      credentialReviewStatus: row.credential_review_status,
      credentialVerificationMethod: row.credential_verification_method ?? null,
      credentialConfirmedBy: row.credential_confirmed_by ?? null,
      credentialConfirmedAt: row.credential_confirmed_at ?? null,
      distanceMeters: row.distance_meters,
      matchScore: row.match_score,
      appliedAt: row.applied_at,
      licenseNumber: row.workers.license_number ?? null,
      licensePhotoUrl: signedLicenseUrl,
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

  const { data: shiftRows, error: shiftError } = await sb
    .from('shifts')
    .select('id')
    .eq('facility_id', facilityId)
    .eq('status', 'open');
  if (shiftError) throw new Error(`지원 건수를 불러오지 못했어요: ${shiftError.message}`);

  if (!shiftRows?.length) return 0;

  const { count, error } = await sb
    .from('shift_applications')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'applied')
    .in('shift_id', shiftRows.map((s: any) => s.id));
  if (error) throw new Error(`지원 건수를 불러오지 못했어요: ${error.message}`);

  return count ?? 0;
}
