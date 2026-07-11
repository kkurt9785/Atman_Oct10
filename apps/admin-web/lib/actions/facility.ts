'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '../admin-auth';
import { adminClient } from '../supabase';
import { grantOnboardingCredit } from '../credits';

export type FacilityProfile = {
  bed_count: number | null;
  main_department: string | null;
  has_parking: boolean;
  has_meals: boolean;
  has_uniform: boolean;
  emr_system: string | null;
  intro: string | null;
};

export async function getFacilityProfile(): Promise<FacilityProfile | null> {
  const context = await requireAdminContext();
  const sb = adminClient();
  if (!sb) return null;

  const { data, error } = await sb
    .from('facilities')
    .select('bed_count, main_department, has_parking, has_meals, has_uniform, emr_system, intro')
    .eq('id', context.facilityId)
    .single();

  if (error) {
    console.error('[getFacilityProfile]', error);
    return null;
  }
  return data as FacilityProfile;
}

export async function saveFacilityProfile(formData: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');

  const bedRaw = String(formData.get('bed_count') ?? '').trim();
  const bedCount = bedRaw ? Number.parseInt(bedRaw, 10) : null;
  if (bedCount !== null && (!Number.isInteger(bedCount) || bedCount < 0 || bedCount > 10000)) {
    throw new Error('병상 수를 다시 확인해 주세요.');
  }

  const intro = String(formData.get('intro') ?? '').trim();
  const patch = {
    bed_count: bedCount,
    main_department: String(formData.get('main_department') ?? '').trim().slice(0, 100) || null,
    has_parking: formData.get('has_parking') === 'on',
    has_meals: formData.get('has_meals') === 'on',
    has_uniform: formData.get('has_uniform') === 'on',
    emr_system: String(formData.get('emr_system') ?? '').trim().slice(0, 100) || null,
    intro: intro.slice(0, 2000) || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from('facilities').update(patch).eq('id', context.facilityId);
  if (error) throw new Error(error.message);

  if (intro.length > 0 || bedCount !== null) {
    await grantOnboardingCredit(sb, context.facilityId, 'onboard_profile');
  }

  const { error: auditError } = await sb.from('audit_logs').insert({
    actor_type: 'admin',
    actor_id: context.user.id,
    action: 'facility.profile.update',
    entity_type: 'facility',
    entity_id: context.facilityId,
    after_data: patch,
  });
  if (auditError) console.error('[saveFacilityProfile] audit log failed', auditError);

  revalidatePath('/settings');
}
