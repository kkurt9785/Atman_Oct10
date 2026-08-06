'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getAdminContext, requireAdminContext } from '../admin-auth';
import { adminClient } from '../supabase';

export type FacilityProfile = {
  bed_count: number | null;
  main_department: string | null;
  has_parking: boolean;
  has_meals: boolean;
  has_uniform: boolean;
  emr_system: string | null;
  intro: string | null;
  pharmacy_type: string | null;
  pharmacy_system: string | null;
  average_daily_prescriptions: number | null;
  handover_minutes: number | null;
  attendance_mode: 'gps'|'gps_qr'|'qr'|'admin'|'gps_or_qr';
  gps_radius_meters: number;
  max_gps_accuracy_meters: number;
  qr_fallback_enabled: boolean;
  check_in_before_minutes: number;
  check_in_after_minutes: number;
  check_out_before_minutes: number;
  check_out_after_minutes: number;
  allowed_ips: string[];
};

export async function getFacilityProfile(): Promise<FacilityProfile | null> {
  const context = await requireAdminContext();
  const sb = adminClient();
  if (!sb) return null;

  const [{ data, error },{data:attendance}] = await Promise.all([sb
    .from('facilities')
    .select('bed_count, main_department, has_parking, has_meals, has_uniform, emr_system, intro, pharmacy_type, pharmacy_system, average_daily_prescriptions, handover_minutes')
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
    allowed_ips:attendance?.allowed_ips??[],
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
  const prescriptionRaw=String(formData.get('average_daily_prescriptions')??'').trim();
  const averageDailyPrescriptions=prescriptionRaw?Number.parseInt(prescriptionRaw,10):null;
  const handoverRaw=String(formData.get('handover_minutes')??'').trim();
  const handoverMinutes=handoverRaw?Number.parseInt(handoverRaw,10):null;
  if(averageDailyPrescriptions!==null&&(!Number.isInteger(averageDailyPrescriptions)||averageDailyPrescriptions<0||averageDailyPrescriptions>10000))throw new Error('일평균 처방전 수를 확인해 주세요.');
  if(handoverMinutes!==null&&(!Number.isInteger(handoverMinutes)||handoverMinutes<0||handoverMinutes>240))throw new Error('인수인계 시간을 확인해 주세요.');
  const patch = {
    bed_count: bedCount,
    main_department: String(formData.get('main_department') ?? '').trim().slice(0, 100) || null,
    has_parking: formData.get('has_parking') === 'on',
    has_meals: formData.get('has_meals') === 'on',
    has_uniform: formData.get('has_uniform') === 'on',
    emr_system: String(formData.get('emr_system') ?? '').trim().slice(0, 100) || null,
    intro: intro.slice(0, 2000) || null,
    pharmacy_type:String(formData.get('pharmacy_type')??'').trim().slice(0,50)||null,
    pharmacy_system:String(formData.get('pharmacy_system')??'').trim().slice(0,100)||null,
    average_daily_prescriptions:averageDailyPrescriptions,
    handover_minutes:handoverMinutes,
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

const MAX_WORKPLACE_IPS = 5;

async function requestPublicIp(): Promise<string | null> {
  const h = await headers();
  const raw = h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '';
  const ip = raw.trim();
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  return ip.slice(0, 45);
}

// 관리자가 사업장 와이파이에서 누르면, 그 요청의 공인 IP를 인증 네트워크로 등록.
// 워커의 출퇴근 RPC(Supabase)도 같은 회선으로 나가므로 공인 IP가 일치한다.
export async function registerWorkplaceNetwork(): Promise<{ ip: string; allowed_ips: string[] }> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');

  const ip = await requestPublicIp();
  if (!ip) throw new Error('현재 네트워크의 공인 IP를 확인할 수 없어요. 사업장 와이파이에 연결한 뒤 다시 시도해 주세요.');

  const { data: settings } = await sb.from('facility_attendance_settings')
    .select('allowed_ips').eq('facility_id', context.facilityId).maybeSingle();
  const current: string[] = settings?.allowed_ips ?? [];
  const next = current.includes(ip) ? current : [...current, ip].slice(-MAX_WORKPLACE_IPS);

  const { error } = await sb.from('facility_attendance_settings').upsert({
    facility_id: context.facilityId, allowed_ips: next,
    updated_by: context.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'facility_id' });
  if (error) throw new Error(error.message);

  const { error: auditError } = await sb.from('audit_logs').insert({
    actor_type: 'admin', actor_id: context.user.id,
    action: 'facility.workplace_network.register',
    entity_type: 'facility', entity_id: context.facilityId,
    after_data: { ip, allowed_ips: next },
  });
  if (auditError) console.error('[registerWorkplaceNetwork] audit log failed', auditError);

  revalidatePath('/settings');
  return { ip, allowed_ips: next };
}

export async function clearWorkplaceNetworks(): Promise<void> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');

  const { error } = await sb.from('facility_attendance_settings').upsert({
    facility_id: context.facilityId, allowed_ips: [],
    updated_by: context.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'facility_id' });
  if (error) throw new Error(error.message);

  const { error: auditError } = await sb.from('audit_logs').insert({
    actor_type: 'admin', actor_id: context.user.id,
    action: 'facility.workplace_network.clear',
    entity_type: 'facility', entity_id: context.facilityId,
    after_data: { allowed_ips: [] },
  });
  if (auditError) console.error('[clearWorkplaceNetworks] audit log failed', auditError);

  revalidatePath('/settings');
}

export type FacilityAdminRow = {
  userId: string;
  email: string;
  role: 'owner' | 'operator' | 'sales' | 'super';
  canViewPayroll: boolean;
};

// 소유자·전체 관리(super)만 관리자 목록을 본다. 그 외 등급에는 null (섹션 미노출).
export async function getFacilityAdmins(): Promise<FacilityAdminRow[] | null> {
  const context = await getAdminContext();
  if (!context || (context.accessRole !== 'owner' && context.accessRole !== 'super')) return null;
  const sb = adminClient();
  if (!sb) return null;

  const [{ data: facility }, { data: delegated }] = await Promise.all([
    sb.from('facilities').select('admin_user_id').eq('id', context.facilityId).maybeSingle(),
    sb.from('facility_admin_access').select('user_id, access_role, can_view_payroll')
      .eq('facility_id', context.facilityId).order('created_at'),
  ]);

  const rows: FacilityAdminRow[] = [];
  const ids = [
    ...(facility?.admin_user_id ? [{ id: facility.admin_user_id as string, role: 'owner' as const, canView: true }] : []),
    ...(delegated ?? []).map((d) => ({
      id: d.user_id as string,
      role: d.access_role as 'operator' | 'sales' | 'super',
      canView: d.can_view_payroll === true,
    })),
  ];
  for (const entry of ids) {
    if (rows.some((r) => r.userId === entry.id)) continue;
    const { data } = await sb.auth.admin.getUserById(entry.id);
    rows.push({ userId: entry.id, email: data?.user?.email ?? '알 수 없음', role: entry.role, canViewPayroll: entry.canView });
  }
  return rows;
}

export async function setAdminPayrollVisibility(targetUserId: string, allow: boolean): Promise<void> {
  const context = await requireAdminContext(['owner', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');

  const { data: updated, error } = await sb.from('facility_admin_access')
    .update({ can_view_payroll: allow })
    .eq('facility_id', context.facilityId).eq('user_id', targetUserId)
    .select('user_id');
  if (error) throw new Error(error.message);
  if (!updated?.length) throw new Error('이 사업장의 위임 관리자가 아니에요.');

  const { error: auditError } = await sb.from('audit_logs').insert({
    actor_type: 'admin', actor_id: context.user.id,
    action: 'facility.payroll_visibility.update',
    entity_type: 'facility', entity_id: context.facilityId,
    after_data: { target_user_id: targetUserId, can_view_payroll: allow },
  });
  if (auditError) console.error('[setAdminPayrollVisibility] audit log failed', auditError);

  revalidatePath('/settings');
  revalidatePath('/payroll');
  revalidatePath('/');
}
