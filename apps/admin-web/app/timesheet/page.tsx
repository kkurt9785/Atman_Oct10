import Link from 'next/link';
import { getClinicStaff, getTodayAttendanceFailures } from '@/lib/db/clinic-workforce';
import { getStaff, getUpcomingMatchedShifts } from '@/lib/db/staff';
import { AttendanceDashboard } from './AttendanceDashboard';
import { getShop } from '@/lib/db/shop';
import { getCurrentFacilityId } from '@/lib/facility';
import { OperationsFlow } from '@/components/OperationsFlow';

export default async function TimesheetPage(){
  const [staff,matched,upcoming,failures,shop,facilityId]=await Promise.all([
    getClinicStaff(),
    getStaff(),
    getUpcomingMatchedShifts(),
    getTodayAttendanceFailures(),
    getShop(),
    getCurrentFacilityId(),
  ]);
  const facilityWord=shop?.facilityType==='pharmacy'?'약국':shop?.facilityType==='care_hospital'?'요양병원':'병원';
  const currentMonth=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  const recentComplete=new Date(`${currentMonth}-01T00:00:00Z`);recentComplete.setUTCMonth(recentComplete.getUTCMonth()-1);
  const summaryHref=shop?.isDemo?`/attendance-summary?month=${recentComplete.toISOString().slice(0,7)}`:'/attendance-summary';
  const today=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'});

  return <main className="px-4 pb-28">
    <div className="mt-3 px-1">
      <p className="text-label font-bold text-primary">{facilityWord} 인력을 한 흐름으로</p>
      <h1 className="text-display font-extrabold">오늘 근태</h1>
      <p className="mt-1 text-label text-sub">{today} · 기존 직원과 오늘 확정된 단기 인력을 함께 관리해요.</p>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2">
      <Link href="/staff" className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">직원 관리</Link>
      <Link href="/attendance-qr" className="flex h-11 items-center justify-center rounded-xl bg-primary text-label font-bold text-white">출퇴근 인증</Link>
      <Link href="/leave" className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">휴가 관리</Link>
    </div>
    <div className="mt-3"><OperationsFlow active="attendance"/></div>
    <AttendanceDashboard staff={staff} matched={matched} upcoming={upcoming} failures={failures} facilityId={facilityId} summaryHref={summaryHref}/>
    <p className="mt-4 px-1 text-[11px] leading-5 text-sub">{facilityWord} 관리자가 입력·승인한 운영 기록입니다. 법정 휴가와 임금의 최종 판단은 사업장의 계약 및 취업규칙을 기준으로 확인해 주세요.</p>
  </main>;
}
