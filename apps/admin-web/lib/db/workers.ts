import { getAdminContext } from '../admin-auth';
import { adminClient } from '../supabase';
import { createLicenseSignedUrl } from '../license-storage';

export type PendingWorker = {
  id: string;
  name: string;
  role: 'rn' | 'na';
  phone: string | null;
  licenseNumber: string | null;
  licensePhotoUrl: string | null;
  createdAt: string;
};

/**
 * 면허 심사는 시설 운영 기능이 아니라 플랫폼 운영자(super) 기능이다.
 * 일반 시설 관리자가 다른 시설과 무관한 워커의 민감 서류를 열람하지 못하도록
 * service-role 조회 전에 현재 세션의 플랫폼 역할을 확인한다.
 */
export async function getPendingWorkers(): Promise<PendingWorker[]> {
  const context = await getAdminContext();
  if (context?.accessRole !== 'super') return [];

  const sb = adminClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from('workers')
    .select('id, name, role, phone, license_number, license_photo_url, created_at')
    .in('verification_status', ['pending', 'reviewing'])
    .eq('is_demo', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[getPendingWorkers]', error);
    return [];
  }

  return Promise.all(((data ?? []) as any[]).map(async (worker) => ({
    id: worker.id,
    name: worker.name,
    role: worker.role,
    phone: worker.phone,
    licenseNumber: worker.license_number,
    licensePhotoUrl: await createLicenseSignedUrl(sb, worker.license_photo_url, 300),
    createdAt: worker.created_at,
  })));
}
