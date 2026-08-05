import Link from 'next/link';
import { Card } from '@/components/ui';
import { getAttendanceHistory } from '@/lib/db/attendance-history';
import { getShop } from '@/lib/db/shop';

const ENGAGEMENT:Record<string,string>={regular:'상시',fixed_term:'기간제',temporary:'임시',daily:'단기',shift:'공고 시프트'};
function moveMonth(month:string,delta:number){const d=new Date(`${month}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7);}
function hm(minutes:number){return `${Math.floor(minutes/60)}시간 ${minutes%60}분`;}
function isIssue(status:string,lateMinutes:number,earlyLeaveMinutes:number){return ['late','absent','checkout_pending'].includes(status)||lateMinutes>0||earlyLeaveMinutes>0;}

export default async function AttendanceSummaryPage({searchParams}:{searchParams:Promise<{month?:string}>}){
  const p=await searchParams;
  const current=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  const recentComplete=moveMonth(current,-1);
  const shop=await getShop();
  const requested=/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month??'')?p.month!:(shop?.isDemo?recentComplete:current);
  const minMonth=moveMonth(current,-2);
  const month=requested<minMonth?minMonth:requested>current?current:requested;
  const {rows,closed}=await getAttendanceHistory(month);
  const facilityWord=shop?.facilityType==='pharmacy'?'약국':'병원';
  const people=[...rows.reduce((map,row)=>{
    const key=row.staffId??`shift-${row.name}`;
    const person=map.get(key)??{key,name:row.name,staffId:row.staffId,employment:row.employment,minutes:0,days:0,late:0,early:0,absent:0,leave:0,issues:0};
    person.minutes+=row.workedMinutes;
    person.days+=row.checkInAt?1:0;
    person.late+=row.lateMinutes>0?1:0;
    person.early+=row.earlyLeaveMinutes>0?1:0;
    person.absent+=row.status==='absent'?1:0;
    person.leave+=row.status==='leave'?1:0;
    person.issues+=isIssue(row.status,row.lateMinutes,row.earlyLeaveMinutes)?1:0;
    map.set(key,person);return map;
  },new Map<string,{key:string;name:string;staffId:string|null;employment:string;minutes:number;days:number;late:number;early:number;absent:number;leave:number;issues:number}>()).values()]
    .sort((a,b)=>b.issues-a.issues||b.minutes-a.minutes);
  const totalMinutes=people.reduce((sum,p)=>sum+p.minutes,0);
  const totalIssues=people.reduce((sum,p)=>sum+p.issues,0);
  const totalLeave=people.reduce((sum,p)=>sum+p.leave,0);

  return <main className="px-4 pb-28">
    <div className="mt-3 px-1"><p className="text-label font-bold text-primary">{facilityWord} 월간 현황</p><h1 className="text-display font-extrabold">근태 요약</h1><p className="mt-1 text-label text-sub">먼저 전체 흐름을 보고, 필요한 기록만 상세 확인해요.</p></div>
    <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-bg p-1" aria-label="조회 기간 바로가기">
      <Link href={`/attendance-summary?month=${current}`} className={`flex h-10 items-center justify-center rounded-xl text-[12px] font-bold ${month===current?'bg-white text-primary shadow-sm':'text-sub'}`}>이번 달 · 집계 중</Link>
      <Link href={`/attendance-summary?month=${recentComplete}`} className={`flex h-10 items-center justify-center rounded-xl text-[12px] font-bold ${month===recentComplete?'bg-white text-primary shadow-sm':'text-sub'}`}>지난달</Link>
    </div>
    <div className="mt-3 flex items-center justify-between rounded-2xl bg-white p-2 shadow-sm">
      {month>minMonth?<Link href={`/attendance-summary?month=${moveMonth(month,-1)}`} className="flex h-9 w-9 items-center justify-center text-xl" aria-label="이전 달">‹</Link>:<span className="flex h-9 w-9 items-center justify-center text-line">‹</span>}
      <div className="text-center"><b className="text-[14px]">{month.slice(0,4)}년 {Number(month.slice(5,7))}월</b><p className="mt-0.5 text-[10px] font-bold text-sub">{closed?'마감 완료':month===current?'집계 중':'마감 전'}</p></div>
      {month<current?<Link href={`/attendance-summary?month=${moveMonth(month,1)}`} className="flex h-9 w-9 items-center justify-center text-xl" aria-label="다음 달">›</Link>:<span className="flex h-9 w-9 items-center justify-center text-line">›</span>}
    </div>
    <div className="mt-3 grid grid-cols-3 gap-2">
      <Card className="p-3"><p className="text-[11px] text-sub">근무 인원</p><b className="mt-1 block text-title">{people.length}명</b></Card>
      <Card className="p-3"><p className="text-[11px] text-sub">인정 근무</p><b className="mt-1 block text-[16px] leading-tight">{hm(totalMinutes)}</b></Card>
      <Card className="p-3"><p className="text-[11px] text-sub">확인 필요</p><b className={`mt-1 block text-title ${totalIssues?'text-red-600':'text-emerald-700'}`}>{totalIssues}건</b></Card>
    </div>
    {totalIssues>0&&<Link href={`/attendance-history?month=${month}&type=all&status=issue`} className="mt-3 flex min-h-12 items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4"><span><b className="block text-[13px] text-red-700">확인할 기록 {totalIssues}건</b><span className="mt-0.5 block text-[11px] text-sub">지각·조퇴·결근·퇴근 승인 대기만 확인</span></span><span className="font-bold text-red-600" aria-hidden>›</span></Link>}
    <Card className="mt-4 p-0 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><div><p className="text-[13px] font-extrabold">직원별 누적</p><p className="mt-0.5 text-[11px] text-sub">문제가 있는 직원부터 보여드려요.</p></div>{totalLeave>0&&<span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">휴가 {totalLeave}</span>}</div>
      {people.length===0?<p className="py-9 text-center text-[13px] font-bold">이 달 근태 기록이 없어요.</p>:<div className="divide-y divide-line">{people.map(person=>{
        const content=<><div className="min-w-0"><div className="flex items-center gap-1.5"><b className="truncate text-[13px]">{person.name}</b><span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-bold text-sub">{ENGAGEMENT[person.employment]??person.employment}</span></div><p className="mt-1 text-[11px] text-sub">근무 {person.days}일 · {hm(person.minutes)}</p>{(person.late+person.early+person.absent+person.leave)>0&&<p className="mt-1 text-[10px] font-medium text-sub">{[person.late?`지각 ${person.late}`:'',person.early?`조퇴 ${person.early}`:'',person.absent?`결근 ${person.absent}`:'',person.leave?`휴가 ${person.leave}`:''].filter(Boolean).join(' · ')}</p>}</div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${person.issues?'bg-red-50 text-red-600':'bg-emerald-50 text-emerald-700'}`}>{person.issues?`확인 ${person.issues}`:'정상'}</span>{person.staffId&&<span className="text-primary" aria-hidden>›</span>}</div></>;
        return person.staffId?<Link key={person.key} href={`/attendance-history/staff/${person.staffId}?month=${month}`} className="flex min-h-[72px] items-center justify-between gap-3 px-4 active:bg-bg">{content}</Link>:<div key={person.key} className="flex min-h-[72px] items-center justify-between gap-3 px-4">{content}</div>;
      })}</div>}
    </Card>
    <div className="mt-4 grid grid-cols-2 gap-2"><Link href={`/attendance-history?month=${month}`} className="flex h-11 items-center justify-center rounded-xl border border-line bg-white text-[12px] font-bold">전체 기록·수정</Link><Link href={`/payroll?month=${month}`} className="flex h-11 items-center justify-center rounded-xl bg-primary text-[12px] font-bold text-white">급여 검토</Link></div>
    <Link href="/timesheet" className="mt-3 flex h-10 items-center justify-center text-[12px] font-bold text-sub">← 오늘 근태로</Link>
  </main>;
}
