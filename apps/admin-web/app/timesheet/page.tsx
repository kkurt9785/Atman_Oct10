import Link from 'next/link';
import { getClinicStaff, getTodayAttendanceFailures } from '@/lib/db/clinic-workforce';
import { getStaff } from '@/lib/db/staff';
import { AttendanceDashboard } from './AttendanceDashboard';
import { getShop } from '@/lib/db/shop';

export default async function TimesheetPage(){
  const [staff,matched,failures,shop]=await Promise.all([
    getClinicStaff(),
    getStaff(),
    getTodayAttendanceFailures(),
    getShop(),
  ]);
  const facilityWord=shop?.facilityType==='pharmacy'?'약국':'병원';
  const today=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short'});

  return <main className="px-4 pb-28">
    <div className="mt-3 px-1">
      <p className="text-label font-bold text-primary">{facilityWord} 인력을 한 흐름으로</p>
      <h1 className="text-display font-extrabold">오늘 근태</h1>
      <p className="mt-1 text-label text-sub">{today} · 기존 직원과 오늘 확정된 단기 인력을 함께 관리해요.</p>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2">
      <Link href="/staff" className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">직원 관리</Link>
      <Link href="/attendance-qr" className="flex h-11 items-center justify-center rounded-xl bg-primary text-label font-bold text-white">동적 QR</Link>
      <Link href="/leave" className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-label font-bold">휴가 관리</Link>
    </div>
    <Link href="/attendance-summary" className="mt-3 flex min-h-12 items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 text-label font-bold text-primary"><span><span className="block">이번 달 근태 요약</span><span className="mt-0.5 block text-[11px] font-medium text-sub">누적 시간과 확인할 기록을 먼저 확인</span></span><span aria-hidden>›</span></Link>
    <AttendanceDashboard staff={staff} matched={matched} failures={failures}/>
    <p className="mt-4 px-1 text-[11px] leading-5 text-sub">{facilityWord} 관리자가 입력·승인한 운영 기록입니다. 법정 휴가와 임금의 최종 판단은 사업장의 계약 및 취업규칙을 기준으로 확인해 주세요.</p>
  </main>;
}
