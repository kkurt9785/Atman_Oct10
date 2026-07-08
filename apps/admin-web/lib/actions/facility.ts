'use server';

import { revalidatePath } from 'next/cache';
import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
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
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return null;

  const { data } = await sb
    .from('facilities')
    .select('bed_count, main_department, has_parking, has_meals, has_uniform, emr_system, intro')
    .eq('id', facilityId)
    .single();

  return data as FacilityProfile | null;
}

export async function saveFacilityProfile(formData: FormData) {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) throw new Error('인증 오류');

  const bedStr = (formData.get('bed_count') as string).trim();

  const { error } = await sb
    .from('facilities')
    .update({
      bed_count:       bedStr ? parseInt(bedStr, 10) : null,
      main_department: (formData.get('main_department') as string).trim() || null,
      has_parking:     formData.get('has_parking') === 'on',
      has_meals:       formData.get('has_meals') === 'on',
      has_uniform:     formData.get('has_uniform') === 'on',
      emr_system:      (formData.get('emr_system') as string).trim() || null,
      intro:           (formData.get('intro') as string).trim() || null,
    })
    .eq('id', facilityId);

  if (error) throw new Error(error.message);

  const intro = (formData.get('intro') as string).trim();
  const profileMeaningful = intro.length > 0 || bedStr.length > 0;
  if (profileMeaningful) {
    await grantOnboardingCredit(sb, facilityId, 'onboard_profile');
  }

  revalidatePath('/settings');
}
