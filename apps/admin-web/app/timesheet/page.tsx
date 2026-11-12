import Link from 'next/link';
import { getClinicStaff, getTodayAttendanceFailures } from '@/lib/db/clinic-workforce';
import { getOperationsAlerts } from '@/lib/db/operations';
import { getStaff, getUpcomingMatchedShifts } from '@/lib/db/staff';
import { AttendanceDashboard } from './AttendanceDashboard';
import { getShop } from '@/lib/db/shop';
import { getCurrentFacilityId } from '@/lib/facility';
import { OperationsFlow } from '@/components/OperationsFlow';
import { facilityTypeLabel } from '@/lib/facility-label';
import { AttendanceTabs } from '@/components/AttendanceTabs';

export default async function TimesheetPage({searchParams}:{searchParams:Promise<{staff?:string}>}){
  const {staff: selectedStaffId}=await searchParams;
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
  const isGigworker=shop?.mode==='gig';
  // 단기: 초대를 아직 수락하지 않은 사람은 출근할 수 없다 — 미출근·확인 필요로 세면 홈(오늘 근무 N명·확인 필요)과 숫자가 어긋난다(11/12 운영 QA).
  // 홈 보드처럼 초대 대기로만 다루고, 여기서는 한 줄로 알려 준다.
  const visibleStaff=isGigworker?staff.filter(person=>person.workerId):staff;
  const visibleIds=new Set(visibleStaff.map(person=>person.id));
  const awaitingInvite=isGigworker?staff.filter(person=>!person.workerId&&person.scheduledToday).length:0;
  const currentMonth=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  const recentComplete=new Date(`${currentMonth}-01T00:00:00Z`);recentComplete.setUTCMonth(recentComplete.getUTCMonth()-1);
  const summaryHref=shop?.isDemo?`/attendance-summary?month=${recentComplete.toISOString().slice(0,7)}`:'/attendance-summary';
  // 모집→지급 흐름 띠는 단기 인력이 있을 때만 — 우리 직원만 있는 의원에는 쓰지 않는 단계다(2026-11-10 치과 QA)
  const hasShortTerm=matched.length>0||upcoming.length>0;
  const today=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'});

  return <main className="px-4 pb-28">
    <AttendanceTabs active="today"/>
    <div className="mt-1 px-1">
      <p className="text-label font-bold text-primary">{isGigworker||!hasShortTerm?'오늘 출퇴근을 한눈에':`${facilityWord} 인력을 한 흐름으로`}</p>
      <h1 className="text-display font-extrabold">오늘 근태</h1>
      <p className="mt-1 text-label text-sub">{today} · {isGigworker?'오늘 일정이 있는 근무자만 보여드려요.':hasShortTerm?'기존 직원과 오늘 확정된 단기 인력을 함께 관리해요.':'숫자를 누르면 그 상태의 직원만 보여요.'}</p>
    </div>
    {/* 직원·인증·휴가 바로가기는 하단 탭(직원)과 위 탭 띠에 있다 — 초대 근무(긱) 사업장만 그대로 둔다 */}
    {isGigworker&&<div className="mt-4 grid grid-cols-3 gap-2">
      <Link href={isGigworker?'/staff?view=contract&entry=gigworker':'/staff'} className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">{isGigworker?'근무자 관리':'직원 관리'}</Link>
      <Link href="/attendance-qr" className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">출퇴근 인증</Link>
      <Link href={isGigworker?'/attendance-history':'/leave'} className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">{isGigworker?'전체 내역':'연차 관리'}</Link>
    </div>}
    {!isGigworker&&hasShortTerm&&<div className="mt-3"><OperationsFlow active="attendance"/></div>}
    {selectedStaffId&&<p role="status" className="mt-3 rounded-xl bg-white p-3 text-sm">선택한 근무자: {staff.find(person=>person.id===selectedStaffId)?.name??'현재 현장에서 찾을 수 없어요'} · <Link href="/timesheet" className="font-bold text-primary">전체 근태 보기</Link></p>}
    <AttendanceDashboard key={selectedStaffId??'all'} staff={selectedStaffId?visibleStaff.filter(person=>person.id===selectedStaffId):visibleStaff} matched={isGigworker||selectedStaffId?[]:matched} upcoming={isGigworker||selectedStaffId?[]:upcoming} failures={selectedStaffId?[]:failures} arrivalAlerts={arrivalAlerts.filter((alert) => alert.kind === 'no_show'&&(!selectedStaffId||alert.staffId===selectedStaffId)&&(!isGigworker||!alert.staffId||visibleIds.has(alert.staffId)))} facilityId={facilityId} summaryHref={summaryHref} isGigworker={isGigworker}/>
    {awaitingInvite>0&&<Link href="/staff?view=contract&entry=gigworker" className="mt-3 flex min-h-11 items-center justify-between rounded-xl bg-white px-4 text-[0.75rem] font-bold text-sub shadow-card"><span>오늘 일정이 있는데 초대를 아직 수락하지 않은 근무자 {awaitingInvite}명</span><span className="text-primary">근무자 관리 →</span></Link>}
    <p className="mt-4 px-1 text-[0.6875rem] leading-5 text-sub">{isGigworker?'근무자가 남기고 사장님이 확인한':`${facilityWord} 관리자가 입력·승인한`} 출퇴근 기록이에요. 수정 이력은 감사 기록에 남아요.</p>
  </main>;
}
