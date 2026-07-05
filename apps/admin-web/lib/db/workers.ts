import { adminClient } from '../supabase';

export type PendingWorker = {
  id: string;
  name: string;
  role: 'rn' | 'na';
  phone: string | null;
  licenseNumber: string | null;
  licensePhotoUrl: string | null;
  createdAt: string;
};

export async function getPendingWorkers(): Promise<PendingWorker[]> {
  const sb = adminClient();
  if (!sb) return [];

  const { data } = await sb
    .from('workers')
    .select('id, name, role, phone, license_number, license_photo_url, created_at')
    .in('verification_status', ['pending', 'reviewing'])
    .eq('is_demo', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  return ((data ?? []) as any[]).map((w) => ({
    id: w.id,
    name: w.name,
    role: w.role,
    phone: w.phone,
    licenseNumber: w.license_number,
    licensePhotoUrl: w.license_photo_url,
    createdAt: w.created_at,
  }));
}
