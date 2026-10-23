import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';
import { summarizeCredentials, type Credential } from '../workforce-credentials';

export type WorkforceMember = {
  poolId: string;
  workerId: string;
  name: string;
  role: 'rn' | 'na' | 'pharmacist' | 'pharmacy_staff';
  status: 'active' | 'paused' | 'do_not_invite';
  lastWorkedAt: string | null;
  completedShiftCount: number;
  totalWorkedMinutes: number;
  experienceYears: string | null;
  departmentTags: string[];
  credentialStatus: 'valid' | 'expiring' | 'expired' | 'missing' | 'unknown';
  credentialBlocked: boolean;
  credentialExpiresAt: string | null;
  credentialLabel: string | null;
};

const CREDENTIAL_LABEL: Record<string, string> = {
  nursing_license: '간호사 면허',
  na_certificate: '간호조무사 자격',
  pharmacist_license: '약사 면허',
  health_check: '건강진단서',
  cpr_cert: 'CPR/BLS',
  tuberculosis_test: '결핵검사',
  vaccination: '예방접종',
};

export async function getWorkforcePool(): Promise<WorkforceMember[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) throw new Error('근무 이력을 불러올 수 없어요.');

  const { data: pool, error } = await sb
    .from('facility_worker_pool')
    .select('id,worker_id,status,last_worked_at,completed_shift_count,total_worked_minutes,workers(name,role,experience_years,department_tags,deleted_at)')
    .eq('facility_id', facilityId).gt('completed_shift_count', 0)
    .order('last_worked_at', { ascending: false, nullsFirst: false });
  if (error || (pool?.length ?? 0) >= 1000) throw new Error('전체 근무 이력을 확인하지 못했어요.');
  if (!pool?.length) return [];

  const workerIds = pool.map((row: any) => row.worker_id);
  const { data: credentials, error: credentialError } = await sb
    .from('worker_credentials')
    .select('worker_id,credential_type,expires_at,verification_status')
    .in('worker_id', workerIds)
    .in('verification_status', ['approved', 'expired'])
    .order('expires_at', { ascending: true, nullsFirst: false });

  const today = todayKST();
  const credentialsUnavailable = Boolean(credentialError || (credentials?.length ?? 0) >= 1000);

  return (pool as any[])
    .filter((row) => row.workers && !row.workers.deleted_at)
    .map((row) => {
      const summary = summarizeCredentials(((credentials ?? []) as Credential[]).filter(item => item.worker_id === row.worker_id), row.workers.role, today);
      const credential = credentialsUnavailable ? undefined : summary.selected;
      const credentialStatus = credentialsUnavailable ? 'unknown' : summary.status;
      return {
        poolId: row.id,
        workerId: row.worker_id,
        name: row.workers.name,
        role: row.workers.role,
        status: row.status,
        lastWorkedAt: row.last_worked_at ?? null,
        completedShiftCount: row.completed_shift_count ?? 0,
        totalWorkedMinutes: row.total_worked_minutes ?? 0,
        experienceYears: row.workers.experience_years ?? null,
        departmentTags: row.workers.department_tags ?? [],
        credentialStatus,
        credentialBlocked: credentialsUnavailable || summary.blocked,
        credentialExpiresAt: credential?.expires_at ?? null,
        credentialLabel: credential ? (CREDENTIAL_LABEL[credential.credential_type] ?? credential.credential_type) : null,
      } satisfies WorkforceMember;
    });
}
