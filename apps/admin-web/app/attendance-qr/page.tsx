import Link from 'next/link';
import { getFacilityAttendanceQr } from '@/lib/db/clinic-workforce';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { PrintButton } from './PrintButton';
import { DynamicQrPanel } from './DynamicQrPanel';

export default async function AttendanceQrPage(){
  const token=await getFacilityAttendanceQr();
  const workerOrigin=process.env.NEXT_PUBLIC_WORKER_WEB_URL
    ?? (process.env.NODE_ENV === 'production' ? 'https://itdot.co.kr' : 'http://localhost:3003');
  const qrSrc=token?`${workerOrigin}/workplace/qr?token=${encodeURIComponent(token)}`:null;
  return <main className="px-4 pb-28">
    <div className="mt-3 px-1"><p className="text-label font-bold text-primary">위치 인증이 어려울 때</p><h1 className="text-display font-extrabold">동적 출퇴근 QR</h1><p className="text-label text-sub mt-1">직원은 평소 GPS로 출퇴근하고, 실내 위치가 불안정할 때 이 QR을 스캔해요.</p></div>
    <DynamicQrPanel workerOrigin={workerOrigin}/>
    <details className="mt-6 rounded-2xl border border-line bg-white p-4 print:hidden">
      <summary className="cursor-pointer list-none text-[13px] font-bold text-sub">기존 고정 QR · 호환용 <span className="float-right">펼치기</span></summary>
      <p className="mt-2 text-[12px] leading-5 text-sub">기존에 인쇄한 QR을 계속 써야 할 때만 사용하세요. 외부 촬영 위험이 있어 신규 설치에는 위 동적 QR을 권장합니다.</p>
    <section className="mt-4 rounded-2xl bg-bg p-5 text-center">
      {qrSrc?<iframe title="직원 출퇴근 QR" src={qrSrc} className="w-full h-[320px] border-0 bg-white"/>:<p className="py-20 text-sub">QR을 만들지 못했어요.</p>}
      <p className="text-title font-extrabold">잇닿 직원 출퇴근</p>
      <p className="text-label text-sub mt-2 leading-5">로그인한 직원만 기록할 수 있습니다.<br/>예정 퇴근시간 전 요청은 관리자 승인이 필요합니다.</p>
      <PrintButton/>
    </section>
      <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 p-4 print:hidden"><p className="text-label font-bold text-ink">QR이 외부에 노출됐나요?</p><p className="text-[12px] text-sub mt-1">갱신하면 기존 QR은 즉시 사용할 수 없어요.</p><WorkforceActionForm kind="rotate_qr" successMessage="새 QR로 교체했어요."><button className="mt-3 text-[13px] font-bold text-red-600">기존 QR 폐기하고 새로 만들기</button></WorkforceActionForm></div>
    </details>
    <Link href="/timesheet" className="mt-4 h-12 rounded-xl border border-line bg-white flex items-center justify-center font-bold print:hidden">오늘 근태로 돌아가기</Link>
  </main>;
}
