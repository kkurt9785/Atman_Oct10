'use server';
import { requireAdminContext } from '@/lib/admin-auth';
import { userClient } from '@/lib/supabase';

export async function issueDynamicAttendanceQr(){
  try{
    const context=await requireAdminContext(['owner','operator','super']);
    const sb=userClient(context.accessToken);
    if(!sb)return {ok:false,error:'서버 설정을 확인해 주세요.'} as const;
    const {data,error}=await sb.rpc('issue_facility_attendance_qr',{p_facility_id:context.facilityId});
    if(error)throw error;
    const row=Array.isArray(data)?data[0]:data;
    if(!row?.token)return {ok:false,error:'동적 QR을 만들지 못했어요.'} as const;
    return {ok:true,token:String(row.token),expiresAt:String(row.expires_at)} as const;
  }catch(error){
    return {ok:false,error:error instanceof Error?error.message:'동적 QR을 만들지 못했어요.'} as const;
  }
}
