import Link from 'next/link';
import { getFacilityAttendanceQr } from '@/lib/db/clinic-workforce';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { PrintButton } from './PrintButton';
import { DynamicQrPanel } from './DynamicQrPanel';
import { getFacilityProfile } from '@/lib/actions/facility';
import { getShop } from '@/lib/db/shop';
import { ManageBackLink } from '@/components/ManageBackLink';

const MODE_LABEL:Record<string,string>={
  gps_or_qr:'앱에서 버튼만 누르기 · 필요할 때 QR 보완',
  gps:'위치(GPS) 우선 · QR/Wi-Fi 보완',
  gps_qr:'위치 + 동적 QR 모두 필수',
  qr:'동적 QR만',network:'사업장 Wi-Fi/IP만',admin:'관리자 승인만',
};

export default async function AttendanceQrPage(){
  const [token,profile,shop]=await Promise.all([getFacilityAttendanceQr(),getFacilityProfile(),getShop()]);
  const workerOrigin=process.env.NEXT_PUBLIC_WORKER_WEB_URL
    ?? (process.env.NODE_ENV === 'production' ? 'https://itdot.co.kr' : 'http://localhost:3003');
  const qrSrc=token?`${workerOrigin}/workplace/qr?token=${encodeURIComponent(token)}`:null;
  const facilityWord=shop?.facilityType==='pharmacy'?'약국':shop?.facilityType==='care_hospital'?'요양병원':'병원';
  const mode=profile?.attendance_mode??'gps_or_qr';
  const networkCount=profile?.allowed_ips?.length??0;
  const gpsEnabled=['gps','gps_qr','gps_or_qr'].includes(mode);
  const qrEnabled=['qr','gps_qr'].includes(mode)||(['gps','gps_or_qr'].includes(mode)&&Boolean(profile?.qr_fallback_enabled));
  const networkEnabled=mode==='network'||(networkCount>0&&['gps','gps_or_qr'].includes(mode));
  return <main className="px-4 pb-28">
    <ManageBackLink href="/more/operations" label="근무 운영" />
    <div className="mt-3 px-1"><p className="text-label font-bold text-primary">오늘 출퇴근을 한 곳에서</p><h1 className="text-display font-extrabold">출퇴근 인증센터</h1><p className="text-label text-sub mt-1">QR은 이 화면에 띄워두고, 위치·Wi-Fi 인증은 직원이 워커 앱에서 출퇴근 버튼을 누르면 작동해요.</p></div>
    <section className="mt-4 rounded-2xl bg-ink p-4 text-white print:hidden">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-bold text-white/60">현재 운영 방식</p><p className="mt-1 text-[16px] font-extrabold">{MODE_LABEL[mode]??mode}</p></div><span className="shrink-0 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[11px] font-bold text-emerald-200">사용 중</span></div>
      <div className="mt-3 flex gap-2"><Link href="/settings#attendance-auth" className="flex h-9 flex-1 items-center justify-center rounded-lg bg-white/10 text-[12px] font-bold">인증방식 변경</Link><Link href="/timesheet" className="flex h-9 flex-1 items-center justify-center rounded-lg bg-white text-[12px] font-bold text-ink">오늘 근태 보기</Link></div>
    </section>
    {qrEnabled?<DynamicQrPanel workerOrigin={workerOrigin}/>:<section className="mt-5 rounded-2xl border border-line bg-white p-5 text-center print:hidden"><p className="text-title font-extrabold">동적 QR은 현재 사용 안 함</p><p className="mt-2 text-[12px] leading-5 text-sub">현재 정책에서 QR을 사용하지 않아 QR 화면을 숨겼어요.</p><Link href="/settings#attendance-auth" className="mt-3 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-[12px] font-bold text-white">QR 인증 켜기</Link></section>}
    <section className="mt-5 print:hidden">
      <div className="mb-3 flex items-end justify-between px-1"><div><h2 className="text-title font-extrabold">인증 방법</h2><p className="mt-1 text-[12px] text-sub">세 방식은 대체가 아니라 현장 오류를 줄이는 보완 수단이에요.</p></div></div>
      <div className="space-y-2">
        <article className={`rounded-2xl border bg-white p-4 ${gpsEnabled?'border-primary/30':'border-line opacity-65'}`}><div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xl">📍</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="text-[14px]">위치 원터치</b><span className={`text-[11px] font-bold ${gpsEnabled?'text-success':'text-sub'}`}>{gpsEnabled?`사용 중 · ${profile?.gps_radius_meters??30}m`:'사용 안 함'}</span></div><p className="mt-1 text-[12px] leading-5 text-sub">직원이 워커 앱에서 ‘출근하기’만 누르면 위치를 서버가 확인해요.</p></div></div></article>
        <article className={`rounded-2xl border bg-white p-4 ${qrEnabled?'border-primary/30':'border-line opacity-65'}`}><div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-xl">▦</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="text-[14px]">동적 QR</b><span className={`text-[11px] font-bold ${qrEnabled?'text-success':'text-sub'}`}>{qrEnabled?'사용 중':'사용 안 함'}</span></div><p className="mt-1 text-[12px] leading-5 text-sub">실내 GPS가 불안정할 때 카메라로 스캔해요. 60초마다 자동 갱신돼요.</p></div></div></article>
        <article className={`rounded-2xl border bg-white p-4 ${networkEnabled?'border-primary/30':'border-line opacity-65'}`}><div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-xl">📡</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="text-[14px]">{facilityWord} Wi-Fi/IP</b><span className={`text-[11px] font-bold ${networkEnabled?'text-success':'text-amber-600'}`}>{networkEnabled?`사용 중 · ${networkCount}개`:'등록 필요'}</span></div><p className="mt-1 text-[12px] leading-5 text-sub">등록된 {facilityWord} Wi-Fi에서 워커 앱의 출퇴근 버튼을 누르면 인증해요.</p>{!networkCount&&<Link href="/settings#attendance-auth" className="mt-2 inline-block text-[12px] font-bold text-primary">현재 Wi-Fi 등록하기 →</Link>}</div></div></article>
      </div>
      <details className="mt-3 rounded-xl bg-bg p-3"><summary className="cursor-pointer text-[12px] font-bold text-sub">관리자 승인은 언제 쓰나요?</summary><p className="mt-2 text-[12px] leading-5 text-sub">위치·QR·Wi-Fi를 모두 사용하기 어려운 예외 상황에서만 오늘 근태 화면의 출근·퇴근 승인을 사용하세요. 기록은 감사 로그에 남아요.</p></details>
    </section>
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
