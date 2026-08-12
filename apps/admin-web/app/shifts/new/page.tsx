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
  return <><div className="px-4 pt-2"><OperationsFlow active="recruit" compact/></div><NewShiftForm facilityType={shop?.facilityType ?? 'clinic'} recentShift={recent as any} copiedShift={Boolean(requestedCopy&&recent)} /></>;
}
