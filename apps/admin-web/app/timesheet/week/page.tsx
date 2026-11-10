import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AttendanceTabs } from '@/components/AttendanceTabs';
import { getClinicStaff, getWeekLeaves } from '@/lib/db/clinic-workforce';
import { getShop } from '@/lib/db/shop';
import { todayKST } from '@/lib/date';
import { STAFF_ROLE_LABEL } from '@/lib/constants';
import { validDate, WEEKDAY_LABELS } from '@/lib/staff-schedule';
import { addDays, buildWeekSchedule, weekStartOf, type WeekCell } from '@/lib/week-schedule';

const md=(date:string)=>`${Number(date.slice(5,7))}월 ${Number(date.slice(8,10))}일`;

function Cell({cell,isToday}:{cell:WeekCell;isToday:boolean}){
  const base=`h-14 px-0.5 text-center align-middle ${isToday?'bg-primary/5':''}`;
  if(cell.kind==='leave')return <td className={base}><span className="inline-block rounded-md bg-amber-50 px-1 py-1 text-[0.6875rem] font-extrabold text-amber-700">{cell.leaveLabel}</span></td>;
  if(cell.kind==='paused')return <td className={`${base} text-[0.6875rem] font-bold text-sub`}>휴직</td>;
  if(cell.kind!=='work')return <td className={`${base} text-[0.75rem] text-line`} aria-label={cell.kind==='off'?'쉬는 날':'근무 기간 아님'}>{cell.kind==='off'?'·':'–'}</td>;
  return <td className={base}>
    <span className={`block text-[0.6875rem] font-bold leading-4 tabular-nums ${cell.custom?'text-primary':'text-ink'}`}>{cell.start}</span>
    <span className={`block text-[0.6875rem] leading-4 tabular-nums ${cell.custom?'text-primary':'text-sub'}`}>{cell.end}</span>
    {cell.leaveLabel&&<span className={`block truncate text-[0.5625rem] font-extrabold leading-3 ${cell.leavePending?'text-sub':'text-amber-700'}`}>{cell.leaveLabel.replace(' ','')}{cell.leavePending?' 신청':''}</span>}
  </td>;
}

// 우리 직원 주간 근무표 — 근무요일·요일별 시간·휴가를 한 주 표로 본다(읽기 전용, 바꾸는 곳은 직원 탭)
export default async function WeekSchedulePage({searchParams}:{searchParams:Promise<{week?:string}>}){
  const {week}=await searchParams;
  const shop=await getShop();
  if(shop?.mode==='gig')redirect('/timesheet');
  const today=todayKST();
  const thisWeek=weekStartOf(today);
  const weekStart=week&&validDate(week)?weekStartOf(week):thisWeek;
  const weekEnd=addDays(weekStart,6);
  const [staff,leaves]=await Promise.all([getClinicStaff(),getWeekLeaves(weekStart,weekEnd)]);
  const people=staff.filter(s=>s.workerKind==='staff').map(s=>({id:s.id,name:s.name,role:STAFF_ROLE_LABEL[s.role]??s.role,status:s.status,workWeekdays:s.workWeekdays,baseStart:s.baseStart,baseEnd:s.baseEnd,weekdayHours:s.weekdayHours,contractStart:s.hireDate,contractEnd:s.contractEnd}));
  const {dates,rows,headcount}=buildWeekSchedule(people,leaves,weekStart);

  return <main className="px-4 pb-28">
    <AttendanceTabs active="week"/>
    <div className="mt-1 px-1"><p className="text-label font-bold text-primary">누가 언제 나오나</p><h1 className="text-display font-extrabold">주간 근무표</h1><p className="mt-1 text-label text-sub">등록한 근무요일·시간과 승인한 휴가로 만든 표예요.</p></div>
    <div className="mt-4 flex items-center justify-between rounded-2xl bg-white p-2 shadow-sm">
      <Link href={`/timesheet/week?week=${addDays(weekStart,-7)}`} className="flex h-11 w-11 items-center justify-center text-xl" aria-label="이전 주">‹</Link>
      <div className="text-center"><b className="text-[0.875rem]">{md(weekStart)} ~ {md(weekEnd)}</b>{weekStart===thisWeek?<p className="mt-0.5 text-[0.6875rem] font-bold text-primary">이번 주</p>:<Link href="/timesheet/week" className="mt-0.5 block text-[0.6875rem] font-bold text-primary underline">이번 주로</Link>}</div>
      <Link href={`/timesheet/week?week=${addDays(weekStart,7)}`} className="flex h-11 w-11 items-center justify-center text-xl" aria-label="다음 주">›</Link>
    </div>
    {rows.length===0?<div className="mt-3 rounded-2xl bg-white p-6 text-center shadow-sm"><p className="font-bold text-ink">아직 등록한 직원이 없어요</p><Link href="/staff" className="mt-3 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-[0.875rem] font-bold text-white">직원 등록하기</Link></div>
    :<div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-sm">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{md(weekStart)}부터 {md(weekEnd)}까지 직원별 근무 시간</caption>
        <colgroup><col className="w-[3.75rem]"/>{dates.map(date=><col key={date}/>)}</colgroup>
        <thead><tr className="border-b border-line">
          <th scope="col" className="px-2 py-2 text-left text-[0.6875rem] font-bold text-sub">직원</th>
          {dates.map((date,i)=><th key={date} scope="col" className={`py-2 text-center ${date===today?'bg-primary/5':''}`}>
            <span className={`block text-[0.6875rem] font-bold ${date===today?'text-primary':i>=5?'text-red-500':'text-sub'}`}>{WEEKDAY_LABELS[i]}</span>
            <span className={`block text-[0.8125rem] font-extrabold tabular-nums ${date===today?'text-primary':'text-ink'}`}>{Number(date.slice(8,10))}</span>
          </th>)}
        </tr></thead>
        <tbody>
          {rows.map(row=><tr key={row.id} className="border-b border-line/60">
            <th scope="row" className="px-2 text-left align-middle"><span className="block truncate text-[0.75rem] font-extrabold text-ink">{row.name}</span><span className="block truncate text-[0.625rem] font-medium text-sub">{row.role}</span></th>
            {row.cells.map(cell=><Cell key={cell.date} cell={cell} isToday={cell.date===today}/>)}
          </tr>)}
        </tbody>
        <tfoot><tr>
          <th scope="row" className="px-2 py-2.5 text-left text-[0.6875rem] font-bold text-sub">근무</th>
          {headcount.map((count,i)=><td key={dates[i]} className={`py-2.5 text-center text-[0.75rem] font-extrabold tabular-nums ${dates[i]===today?'bg-primary/5 text-primary':count===0?'text-line':'text-ink'}`}>{count}명</td>)}
        </tr></tfoot>
      </table>
    </div>}
    <p className="mt-3 px-1 text-[0.6875rem] leading-5 text-sub"><b className="text-primary">파란 시간</b>은 그 요일만 다르게 정한 시간이에요. 반차·시간차는 근무 시간 아래에 적혀요. 공고로 온 근무자는 이 표에 없고 <Link href="/timesheet" className="font-bold underline">오늘</Link> 탭에서 봐요.</p>
    <Link href="/staff" className="mt-3 flex h-11 items-center justify-center rounded-xl border border-line bg-white text-[0.8125rem] font-bold text-sub">근무요일·시간 바꾸기 → 직원</Link>
  </main>;
}
