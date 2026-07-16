import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';

export type WorkforceMember = {
  poolId: string;
  workerId: string;
  name: string;
  role: 'rn' | 'na';
  status: 'active' | 'paused' | 'do_not_invite';
  lastWorkedAt: string | null;
  completedShiftCount: number;
  totalWorkedMinutes: number;
  experienceYears: string | null;
  departmentTags: string[];
  credentialStatus: 'valid' | 'expiring' | 'expired' | 'missing';
  credentialExpiresAt: string | null;
  credentialLabel: string | null;
};

const CREDENTIAL_LABEL: Record<string, string> = {
  nursing_license: '간호사 면허',
  na_certificate: '간호조무사 자격',
  health_check: '건강진단서',
  cpr_cert: 'CPR/BLS',
  tuberculosis_test: '결핵검사',
  vaccination: '예방접종',
};

function daysBetween(from: string, to: string) {
  return Math.ceil((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export async function getWorkforcePool(): Promise<WorkforceMember[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];

  const { data: pool, error } = await sb
    .from('facility_worker_pool')
    .select('id,worker_id,status,last_worked_at,completed_shift_count,total_worked_minutes,workers(name,role,experience_years,department_tags,deleted_at)')
    .eq('facility_id', facilityId)
    .order('last_worked_at', { ascending: false, nullsFirst: false });
  if (error || !pool?.length) return [];

  const workerIds = pool.map((row: any) => row.worker_id);
  const { data: credentials } = await sb
    .from('worker_credentials')
    .select('worker_id,credential_type,expires_at,verification_status')
    .in('worker_id', workerIds)
    .in('verification_status', ['approved', 'expired'])
    .order('expires_at', { ascending: true, nullsFirst: false });

  const today = todayKST();
  const nearest = new Map<string, any>();
  for (const credential of (credentials ?? []) as any[]) {
    if (!credential.expires_at) continue;
    const existing = nearest.get(credential.worker_id);
    if (!existing || credential.expires_at < existing.expires_at) nearest.set(credential.worker_id, credential);
  }

  return (pool as any[])
    .filter((row) => row.workers && !row.workers.deleted_at)
    .map((row) => {
      const credential = nearest.get(row.worker_id);
      const remaining = credential?.expires_at ? daysBetween(today, credential.expires_at) : null;
      const credentialStatus: WorkforceMember['credentialStatus'] = credential == null
        ? 'missing'
        : remaining! < 0 || credential.verification_status === 'expired'
          ? 'expired'
          : remaining! <= 30 ? 'expiring' : 'valid';
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
        credentialExpiresAt: credential?.expires_at ?? null,
        credentialLabel: credential ? (CREDENTIAL_LABEL[credential.credential_type] ?? credential.credential_type) : null,
      } satisfies WorkforceMember;
    });
}

