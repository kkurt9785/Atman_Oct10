import Link from 'next/link';
import { Card } from '@/components/ui';
import { getStaffAttendanceDetail } from '@/lib/db/attendance-history';

const STATUS:Record<string,string>={scheduled:'예정',working:'근무 중',checkout_pending:'승인 대기',completed:'완료',late:'지각',absent:'결근',leave:'휴가'};
const ENGAGEMENT:Record<string,string>={regular:'상시',fixed_term:'기간제',temporary:'임시',daily:'단기'};
const ROLE:Record<string,string>={rn:'간호사',na:'간호조무사',pharmacist:'약사',pharmacy_staff:'약국 전산·사무직',coordinator:'코디네이터',admin:'관리·행정',other:'기타'};
const AUTH:Record<string,string>={GPS:'위치',GPS_QR:'위치+QR',QR:'QR',QR_FALLBACK:'QR 보완',ADMIN:'관리자',qr:'기존 QR',button:'원터치'};
function moveMonth(month:string,delta:number){const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7);}
function dt(iso:string|null){if(!iso)return '—';return new Date(iso).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});}
function hm(min:number){return `${Math.floor(min/60)}시간 ${min%60}분`;}

export default async function StaffAttendancePage({params,searchParams}:{params:Promise<{staffId:string}>;searchParams:Promise<{month?:string}>}){
  const {staffId}=await params;const p=await searchParams;
  const current=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  const requested=/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month??'')?p.month!:current;
  const month=requested>current?current:requested;
  const {staff,rows,firstWorkDate,summary}=await getStaffAttendanceDetail(staffId,month);
  if(!staff)return <main className="px-4"><Card className="mt-8 py-10 text-center"><p className="text-body font-bold">직원을 찾을 수 없어요</p><Link href="/attendance-history" className="mt-3 inline-block text-label font-bold text-primary">근태 내역으로 →</Link></Card></main>;
  const firstMonth=firstWorkDate?.slice(0,7)??current;
  const hasPrev=month>firstMonth,hasNext=month<current;
  return <main className="px-4 pb-28">
    <div className="mt-3 px-1">
      <Link href="/attendance-history" className="text-label font-bold text-primary">← 근태 내역</Link>
      <div className="mt-2 flex items-center gap-2">
        <h1 className="text-display font-extrabold">{staff.name}</h1>
        <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-bold text-sub">{ROLE[staff.role]??staff.role} · {ENGAGEMENT[staff.engagementType]??staff.engagementType}</span>
      </div>
      <p className="mt-1 text-label text-sub">{staff.department??'부서 미지정'}{staff.defaultStart?` · 근무 ${staff.defaultStart.slice(0,5)}~${staff.defaultEnd?.slice(0,5)??''}`:''}{firstWorkDate?` · 첫 기록 ${firstWorkDate}`:''}</p>
    </div>
    <div className="mt-4 flex items-center justify-between rounded-2xl bg-white p-2 shadow-sm">
      {hasPrev?<Link href={`/attendance-history/staff/${staffId}?month=${moveMonth(month,-1)}`} className="flex h-9 w-9 items-center justify-center text-xl">‹</Link>:<span className="flex h-9 w-9 items-center justify-center text-xl text-line">‹</span>}
      <b className="text-[14px]">{month.replace('-','년 ')}월</b>
      {hasNext?<Link href={`/attendance-history/staff/${staffId}?month=${moveMonth(month,1)}`} className="flex h-9 w-9 items-center justify-center text-xl">›</Link>:<span className="flex h-9 w-9 items-center justify-center text-xl text-line">›</span>}
    </div>
    <div className="mt-3 grid grid-cols-3 gap-2">
      <Card className="p-3"><p className="text-[11px] text-sub">근무일</p><b className="mt-1 block text-title">{summary.workDays}일</b></Card>
      <Card className="p-3"><p className="text-[11px] text-sub">인정 근무</p><b className="mt-1 block text-title">{Math.floor(summary.workedMinutes/60)}시간</b></Card>
      <Card className="p-3"><p className="text-[11px] text-sub">지각·조퇴</p><b className={`mt-1 block text-title ${summary.lateCount>0||summary.earlyLeaveMinutes>0?'text-warn':''}`}>{summary.lateCount}회{summary.earlyLeaveMinutes>0?` · ${summary.earlyLeaveMinutes}분`:''}</b></Card>
    </div>
    {summary.absentCount>0&&<Card className="mt-2 border border-red-200 bg-red-50 p-3 text-[12px] font-bold text-red-600">이 달 결근 {summary.absentCount}건</Card>}
    <div className="mt-5 space-y-3">
      {rows.length===0?<Card className="py-9 text-center font-bold">{month.replace('-','년 ')}월 근태 기록이 없어요.</Card>:rows.map(row=><Card key={row.id} className="p-4">
        <div className="flex justify-between gap-3">
          <p className="text-[13px] font-bold">{row.workDate} <span className="ml-1 font-medium text-sub">예정 {row.scheduledStart?.slice(0,5)??'—'}~{row.scheduledEnd?.slice(0,5)??'—'}</span></p>
          <span className="h-fit rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold">{STATUS[row.status]??row.status}</span>
        </div>
        <div className="mt-3 rounded-xl bg-bg p-3 text-[12px]">
          <div className="flex justify-between"><span className="text-sub">실제 출퇴근</span><b>{dt(row.checkInAt)} → {dt(row.checkOutAt)}</b></div>
          <div className="mt-2 flex justify-between"><span className="text-sub">인정 근무</span><b>{hm(row.workedMinutes)}</b></div>
          <div className="mt-2 flex justify-between"><span className="text-sub">인증</span><b>{AUTH[row.method??'']??row.method??'—'}</b></div>
          {(row.lateMinutes>0||row.earlyLeaveMinutes>0)&&<p className="mt-2 text-right font-bold text-warn">{row.lateMinutes>0?`지각 ${row.lateMinutes}분`:''}{row.earlyLeaveMinutes>0?` · 조퇴 ${row.earlyLeaveMinutes}분`:''}</p>}
          {row.correctionReason&&<p className="mt-2 text-[11px] text-sub">수정 사유: {row.correctionReason}</p>}
        </div>
      </Card>)}
    </div>
    <p className="mt-4 text-center text-[11px] text-sub">기록 수정·월 마감은 근태 내역(최근 3개월)에서 할 수 있어요.</p>
  </main>;
}
