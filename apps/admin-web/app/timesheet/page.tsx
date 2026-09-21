import Link from 'next/link';
import { getClinicStaff, getTodayAttendanceFailures } from '@/lib/db/clinic-workforce';
import { getOperationsAlerts } from '@/lib/db/operations';
import { getStaff, getUpcomingMatchedShifts } from '@/lib/db/staff';
import { AttendanceDashboard } from './AttendanceDashboard';
import { getShop } from '@/lib/db/shop';
import { getCurrentFacilityId } from '@/lib/facility';
import { OperationsFlow } from '@/components/OperationsFlow';
import { facilityTypeLabel } from '@/lib/facility-label';

export default async function TimesheetPage(){
  const [staff,matched,upcoming,failures,arrivalAlerts,shop,facilityId]=await Promise.all([
    getClinicStaff(),
    getStaff(),
    getUpcomingMatchedShifts(),
    getTodayAttendanceFailures(),
    getOperationsAlerts(),
    getShop(),
    getCurrentFacilityId(),
  ]);
  const facilityWord=facilityTypeLabel(shop?.facilityType);
  const isGigworker=shop?.registrationSource==='gigworker_trial';
  const currentMonth=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  const recentComplete=new Date(`${currentMonth}-01T00:00:00Z`);recentComplete.setUTCMonth(recentComplete.getUTCMonth()-1);
  const summaryHref=shop?.isDemo?`/attendance-summary?month=${recentComplete.toISOString().slice(0,7)}`:'/attendance-summary';
  const today=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'});

  return <main className="px-4 pb-28">
    <div className="mt-3 px-1">
      <p className="text-label font-bold text-primary">{isGigworker?'오늘 출퇴근을 한눈에':`${facilityWord} 인력을 한 흐름으로`}</p>
      <h1 className="text-display font-extrabold">오늘 근태</h1>
      <p className="mt-1 text-label text-sub">{today} · {isGigworker?'오늘 일정이 있는 근무자만 보여드려요.':'기존 직원과 오늘 확정된 단기 인력을 함께 관리해요.'}</p>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2">
      <Link href={isGigworker?'/staff?view=contract&entry=gigworker':'/staff'} className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">{isGigworker?'근무자 관리':'직원 관리'}</Link>
      <Link href="/attendance-qr" className="flex h-11 items-center justify-center rounded-xl bg-primary text-label font-bold text-white">출퇴근 인증</Link>
      <Link href={isGigworker?'/attendance-history':'/leave'} className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">{isGigworker?'전체 내역':'휴가 관리'}</Link>
    </div>
    {!isGigworker&&<div className="mt-3"><OperationsFlow active="attendance"/></div>}
    <AttendanceDashboard staff={staff} matched={isGigworker?[]:matched} upcoming={isGigworker?[]:upcoming} failures={failures} arrivalAlerts={arrivalAlerts.filter((alert) => alert.kind === 'no_show')} facilityId={facilityId} summaryHref={summaryHref} isGigworker={isGigworker}/>
    <p className="mt-4 px-1 text-[11px] leading-5 text-sub">{facilityWord} 관리자가 입력·승인한 출퇴근 기록입니다. 수정 이력은 감사 기록에 남아요.</p>
  </main>;
}
