import Link from 'next/link';
import { getShop } from '@/lib/db/shop';
import NewShiftForm from './NewShiftForm';
import { adminClient } from '@/lib/supabase';
import { getCurrentFacilityId } from '@/lib/facility';
import { OperationsFlow } from '@/components/OperationsFlow';

export default async function NewShiftPage({searchParams}:{searchParams:Promise<{copy?:string}>}) {
  const requestedCopy=(await searchParams).copy;
  const [shop,facilityId]=await Promise.all([getShop(),getCurrentFacilityId()]);
  const sb=adminClient();
  let query=sb&&facilityId?sb.from('shifts')
    .select('required_role,start_time,end_time,hourly_wage,description,department,notes')
    .eq('facility_id',facilityId).neq('status','cancelled'):null;
  if(query)query=requestedCopy?query.eq('id',requestedCopy):query.order('created_at',{ascending:false});
  const {data:recent}=query?await query.limit(1).maybeSingle():{data:null};
  if (shop && shop.approvedAt === null && shop.registrationSource.startsWith('self_')) {
    return <main className="px-4 pt-2"><OperationsFlow active="recruit" compact/>
      <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-[15px] font-bold text-amber-800">사업장 확인이 끝나면 공고를 올릴 수 있어요</p>
        <p className="mt-2 text-[13px] leading-5 text-amber-700">잇닿이 사업장 정보를 확인하는 중이에요(보통 1영업일). 그동안 직원 등록과 출퇴근 인증 설정을 먼저 해두면 확인 즉시 모집을 시작할 수 있어요.</p>
        <div className="mt-4 flex gap-2">
          <Link href="/staff" className="h-11 flex-1 rounded-xl bg-primary text-center text-[14px] font-bold leading-[44px] text-white">직원 등록하기</Link>
          {!shop.brnSubmitted && !shop.brnDocumentPath && <Link href="/settings#brn-document" className="h-11 flex-1 rounded-xl border border-amber-300 bg-white text-center text-[14px] font-bold leading-[44px] text-amber-800">사업자 서류 올리기</Link>}
        </div>
      </section></main>;
  }
  return <><div className="px-4 pt-2"><OperationsFlow active="recruit" compact/></div><NewShiftForm facilityType={shop?.facilityType ?? 'clinic'} recentShift={recent as any} copiedShift={Boolean(requestedCopy&&recent)} /></>;
}
