'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '../admin-auth';
import { adminClient } from '../supabase';

export type FacilityProfile = {
  bed_count: number | null;
  main_department: string | null;
  has_parking: boolean;
  has_meals: boolean;
  has_uniform: boolean;
  emr_system: string | null;
  intro: string | null;
  attendance_mode: 'gps'|'gps_qr'|'qr'|'admin'|'gps_or_qr';
  gps_radius_meters: number;
  max_gps_accuracy_meters: number;
  qr_fallback_enabled: boolean;
  check_in_before_minutes: number;
  check_in_after_minutes: number;
  check_out_before_minutes: number;
  check_out_after_minutes: number;
};

export async function getFacilityProfile(): Promise<FacilityProfile | null> {
  const context = await requireAdminContext();
  const sb = adminClient();
  if (!sb) return null;

  const [{ data, error },{data:attendance}] = await Promise.all([sb
    .from('facilities')
    .select('bed_count, main_department, has_parking, has_meals, has_uniform, emr_system, intro')
    .eq('id', context.facilityId)
    .single(),sb.from('facility_attendance_settings').select('*').eq('facility_id',context.facilityId).maybeSingle()]);

  if (error) {
    console.error('[getFacilityProfile]', error);
    return null;
  }
  return {...data,
    attendance_mode:attendance?.authentication_mode??'gps_or_qr',
    gps_radius_meters:attendance?.gps_radius_meters??30,
    max_gps_accuracy_meters:attendance?.max_gps_accuracy_meters??80,
    qr_fallback_enabled:attendance?.qr_fallback_enabled??true,
    check_in_before_minutes:attendance?.check_in_before_minutes??60,
    check_in_after_minutes:attendance?.check_in_after_minutes??60,
    check_out_before_minutes:attendance?.check_out_before_minutes??60,
    check_out_after_minutes:attendance?.check_out_after_minutes??120,
  } as FacilityProfile;
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
  const mode=String(formData.get('attendance_mode')??'gps_or_qr');
  const allowedModes=['gps','gps_qr','qr','admin','gps_or_qr'];
  const radius=Number(formData.get('gps_radius_meters')??30);
  const accuracy=Number(formData.get('max_gps_accuracy_meters')??80);
  if(!allowedModes.includes(mode)||![10,20,30,50,100].includes(radius)||accuracy<10||accuracy>500){
    throw new Error('근태 인증 설정을 다시 확인해 주세요.');
  }
  const attendancePatch={
    facility_id:context.facilityId,authentication_mode:mode,gps_radius_meters:radius,
    max_gps_accuracy_meters:accuracy,qr_fallback_enabled:formData.get('qr_fallback_enabled')==='on',
    check_in_before_minutes:Number(formData.get('check_in_before_minutes')??60),
    check_in_after_minutes:Number(formData.get('check_in_after_minutes')??60),
    check_out_before_minutes:Number(formData.get('check_out_before_minutes')??60),
    check_out_after_minutes:Number(formData.get('check_out_after_minutes')??120),
    updated_by:context.user.id,updated_at:new Date().toISOString(),
  };
  const {error:attendanceError}=await sb.from('facility_attendance_settings').upsert(attendancePatch,{onConflict:'facility_id'});
  if(attendanceError)throw new Error(attendanceError.message);

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
