'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';
import type { GigOperationStatus, GigOperationsBoard as Board, GigOperationWorker } from '@/lib/db/gig-operations';
import { projectRunsOn, projectScheduleText, type GigProject } from '@/lib/db/gig-projects';

type Filter = 'all'|'issue'|'working'|'invite'|'pay';
type Compose = 'message'|'check'|null;

const STATUS_STYLE: Record<GigOperationStatus,string> = {
  invite:'bg-violet-50 text-violet-700',scheduled:'bg-primary/10 text-primary',late:'bg-red-50 text-red-600',
  working:'bg-emerald-50 text-emerald-700',review:'bg-amber-50 text-amber-700',completed:'bg-bg text-sub',
  bank:'bg-amber-50 text-amber-700',pay:'bg-primary/10 text-primary',paid:'bg-emerald-50 text-emerald-700',off:'bg-bg text-sub',
};
const time = (value:string|null) => value ? new Date(value).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}) : '—';

function belongs(row:GigOperationWorker,filter:Filter) {
  if(filter==='all') return true;
  if(filter==='issue') return row.status==='review'||row.status==='late';
  if(filter==='working') return row.status==='working'||row.status==='scheduled'||row.status==='completed';
  if(filter==='invite') return row.status==='invite';
  return row.status==='pay'||row.status==='bank'||row.status==='paid';
}
function actionFor(row:GigOperationWorker) {
  if(row.status==='invite') return {href:'/staff?view=contract&entry=gigworker',label:'잇기 확인'};
  if(row.status==='review'||row.status==='late') return {href:'/timesheet',label:'근태 처리'};
  if(row.status==='pay'||row.status==='bank'||row.status==='paid') return {href:'/gig-pay',label:'지급 확인'};
  return {href:`/workroom?staff=${row.staffId}`,label:'대화'};
}

export function GigOperationsBoard({ board, projects, facilityId, facilityName }: { board: Board; projects: GigProject[]; facilityId: string; facilityName: string }) {
  const router=useRouter();
  const [filter,setFilter]=useState<Filter>('all');
  const [selectedDate,setSelectedDate]=useState(board.today);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [compose,setCompose]=useState<Compose>(null);
  const [body,setBody]=useState('오늘 근무 일정을 확인해 주세요. 확인 버튼을 눌러 주세요.');
  const [dueAt,setDueAt]=useState('');
  const [sending,setSending]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const visible=useMemo(()=>board.workers.filter((row)=>belongs(row,filter)),[board.workers,filter]);
  const linkedVisible=visible.filter((row)=>row.workerLinked);
  const day=board.days.find((item)=>item.date===selectedDate) ?? board.days[0];

  function toggle(staffId:string) {
    setSelected((current)=>{const next=new Set(current);if(next.has(staffId))next.delete(staffId);else next.add(staffId);return next;});
  }
  function openCompose(kind:Exclude<Compose,null>) {
    setCompose(kind);setError('');setNotice('');
    setBody(kind==='check'?'오늘 근무 일정을 확인해 주세요. 확인 버튼을 눌러 주세요.':'');
  }
  async function submitBulk() {
    if(!compose||selected.size===0||!body.trim())return;
    setSending(true);setError('');
    const ids=[...selected];
    const result=compose==='message'
      ? await supabase.rpc('send_staff_workroom_messages',{p_facility_id:facilityId,p_staff_ids:ids,p_body:body.trim()})
      : await supabase.rpc('create_staff_workroom_checks',{p_facility_id:facilityId,p_staff_ids:ids,p_body:body.trim(),p_due_at:dueAt?new Date(dueAt).toISOString():null});
    setSending(false);
    if(result.error){setError(result.error.message.replace(/^.*?: /,''));return;}
    setNotice(`${Number(result.data??ids.length)}명에게 ${compose==='message'?'메시지를 보냈어요.':'출석 확인을 요청했어요.'}`);
    setCompose(null);setSelected(new Set());setDueAt('');
    fetch('/api/chat/nudge',{method:'POST'}).catch(()=>undefined);
    router.refresh();
  }

  const summary:[Filter,string,number,string][]=[
    ['invite','잇기 대기',board.summary.invite,'text-violet-700'],['working','닿기·근무',board.summary.working,'text-emerald-700'],
    ['issue','확인 필요',board.summary.issue,'text-red-600'],['pay','지급 준비',board.summary.pay,'text-primary'],
  ];

  return <>
    <div className="mt-4 px-1 sm:flex sm:items-end sm:justify-between">
      <div><p className="text-[13px] font-bold text-sub">{facilityName}</p><h1 className="mt-1 text-[27px] font-extrabold tracking-[-0.7px] text-ink">오늘 긱 운영</h1><p className="mt-1 text-[13px] text-sub">잇기(초대·연결)부터 닿기(출퇴근)·지급까지, 필요한 사람부터 처리하세요.</p></div>
      <Link href="/gig-work/new" className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-ink px-4 text-[13px] font-extrabold text-white sm:mt-0 sm:w-auto">＋ 근무 만들기</Link>
    </div>

    {/* 사장님 머릿속 단위는 사람이 아니라 '근무 건'이다 — 행사·반복 근무를 먼저 보고, 그 안에 사람을 넣는다 */}
    <section className="mt-5">
      <div className="flex items-end justify-between px-1"><div><p className="text-[11px] font-bold text-primary">근무 건</p><h2 className="mt-0.5 text-[19px] font-extrabold text-ink">진행·예정 근무 {projects.length}건</h2></div><Link href="/gig-work/new" className="text-[12px] font-bold text-primary">＋ 새 근무</Link></div>
      {projects.length===0?<Link href="/gig-work/new" className="mt-3 block rounded-2xl border-2 border-dashed border-line bg-white px-4 py-7 text-center active:bg-bg"><b className="text-[15px] text-ink">첫 근무를 만들어 보세요</b><span className="mt-1 block text-[12px] text-sub">행사 하루든 매주 반복이든 하나 만들고 여러 명을 넣으면 돼요.</span></Link>
        :<div className="mt-3 grid gap-2 lg:grid-cols-2">{projects.map((project)=>{const today=projectRunsOn(project,board.today);const filled=project.participants.length;const working=project.participants.filter((p)=>p.todayStatus==='working'||p.todayStatus==='late').length;const pending=project.participants.filter((p)=>!p.workerLinked).length;return <Link key={project.id} href={`/gig-work/${project.id}`} className={`rounded-2xl border bg-white p-4 shadow-sm active:bg-bg ${today?'border-primary/40':'border-transparent'}`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="text-[16px] text-ink">{project.title}</b>{today&&<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold text-primary">오늘</span>}</div><p className="mt-1 text-[12px] text-sub">{projectScheduleText(project)}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${filled>=project.headcount?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{filled}/{project.headcount}명</span></div>
          <p className="mt-2 text-[11px] text-tertiary">{project.payRate?`시급 ${project.payRate.toLocaleString('ko-KR')}원`:'시급 미정'}{pending>0?` · 잇기 대기 ${pending}명`:''}{today&&working>0?` · 근무 중 ${working}명`:''}{filled<project.headcount?` · ${project.headcount-filled}명 더 필요`:''}</p>
        </Link>;})}</div>}
    </section>

    <div className="mt-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summary.map(([key,label,count,color])=><button key={key} type="button" onClick={()=>setFilter(filter===key?'all':key)} className={`rounded-2xl border p-3 text-left ${filter===key?'border-primary bg-primary/5':'border-transparent bg-white shadow-sm'}`}><p className="text-[11px] text-sub">{label}</p><p className={`mt-1 text-[21px] font-extrabold ${color}`}>{count}<span className="ml-0.5 text-[11px] font-bold">{key==='issue'?'건':'명'}</span></p></button>)}
      </div>
    </div>

    {notice&&<p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-[12px] font-bold text-emerald-700">{notice}</p>}

    <section className="mt-5">
      <div className="flex items-end justify-between px-1"><div><p className="text-[11px] font-bold text-primary">먼저 확인</p><h2 className="mt-0.5 text-[19px] font-extrabold text-ink">{filter==='all'?'전체 근무자':'선택한 상태'}</h2></div>{linkedVisible.length>0&&<button type="button" onClick={()=>setSelected(new Set(linkedVisible.map((row)=>row.staffId)))} className="text-[12px] font-bold text-primary">연결된 근무자 전체 선택</button>}</div>
      {visible.length===0?<div className="mt-3 rounded-2xl bg-white px-4 py-9 text-center text-[13px] text-sub">해당 상태의 근무자가 없어요.</div>:
        <div className="mt-3 grid gap-2 lg:grid-cols-2">{visible.map((row)=>{const action=actionFor(row);const checked=selected.has(row.staffId);return <article key={row.staffId} className={`rounded-2xl border bg-white p-4 shadow-sm transition ${checked?'border-primary ring-1 ring-primary/15':'border-transparent'}`}>
          <div className="flex items-start gap-3">
            <button type="button" disabled={!row.workerLinked} onClick={()=>toggle(row.staffId)} aria-label={`${row.name} 선택`} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-[13px] font-bold ${checked?'border-primary bg-primary text-white':row.workerLinked?'border-line bg-bg text-transparent':'border-line bg-bg text-tertiary opacity-40'}`}>{checked?'✓':'·'}</button>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="text-[16px] text-ink">{row.name}</b><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${STATUS_STYLE[row.status]}`}>{row.statusLabel}</span>{row.unreadMessages>0&&<span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-extrabold text-white">새 대화 {row.unreadMessages}</span>}</div><p className="mt-1 truncate text-[12px] text-sub">{row.title} · {row.startTime}~{row.endTime}</p><p className="mt-1 text-[11px] text-tertiary">출근 {time(row.checkInAt)} → 퇴근 {time(row.checkOutAt)}{row.unpaidDays>0?` · 미정산 ${row.unpaidDays}일`:''}</p></div>
            <Link href={action.href} className="shrink-0 rounded-xl bg-bg px-3 py-2 text-[11px] font-extrabold text-primary">{action.label}</Link>
          </div>
        </article>;})}</div>}
    </section>

    <section className="mt-6 rounded-3xl bg-white p-4 shadow-sm">
      <div className="flex items-end justify-between px-1"><div><p className="text-[11px] font-bold text-primary">다가오는 일정</p><h2 className="mt-0.5 text-[18px] font-extrabold text-ink">7일 근무 일정</h2></div><Link href="/gig-work/new" className="text-[11px] font-bold text-primary">근무 만들기 →</Link></div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">{board.days.map((item)=><button type="button" key={item.date} onClick={()=>setSelectedDate(item.date)} className={`min-w-[58px] rounded-2xl px-2 py-2.5 text-center ${selectedDate===item.date?'bg-ink text-white':'bg-bg text-sub'}`}><span className="block text-[10px] font-bold">{item.dayLabel}</span><b className="mt-0.5 block text-[13px]">{item.dateLabel}</b><span className={`mt-1 block text-[10px] ${selectedDate===item.date?'text-white/60':'text-tertiary'}`}>{(()=>{const n=projects.filter((project)=>projectRunsOn(project,item.date)).length;return n?`${n}건`:`${item.workers.length}명`;})()}</span></button>)}</div>
      {(()=>{const dayProjects=day?projects.filter((project)=>projectRunsOn(project,day.date)):[];return <div className="mt-3 divide-y divide-line rounded-2xl bg-bg px-3">{dayProjects.length?dayProjects.map((project)=><Link key={`${day?.date}:${project.id}`} href={`/gig-work/${project.id}`} className="flex items-center justify-between gap-3 py-3 active:opacity-70"><div className="min-w-0"><b className="text-[13px] text-ink">{project.title}</b><span className="ml-2 text-[11px] text-sub">{project.participants.length}/{project.headcount}명 · {project.participants.map((p)=>p.name).join(', ')||'참여자 없음'}</span></div><span className="shrink-0 text-[12px] font-bold text-primary">{project.startTime.slice(0,5)}~{project.endTime.slice(0,5)}</span></Link>):day?.workers.length?day.workers.map((row)=><div key={`${day.date}:${row.staffId}`} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><b className="text-[13px] text-ink">{row.name}</b><span className="ml-2 text-[11px] text-sub">{row.title}</span></div><span className="shrink-0 text-[12px] font-bold text-primary">{row.startTime}~{row.endTime}</span></div>):<p className="py-5 text-center text-[12px] text-sub">등록된 근무가 없어요.</p>}</div>;})()}
    </section>

    {selected.size>0&&<div className="fixed inset-x-3 bottom-[calc(74px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl items-center gap-2 rounded-2xl bg-ink p-3 text-white shadow-2xl"><button type="button" onClick={()=>setSelected(new Set())} className="shrink-0 px-2 text-[12px] font-extrabold">{selected.size}명 ×</button><button type="button" onClick={()=>openCompose('check')} className="h-11 flex-1 rounded-xl bg-white/10 text-[12px] font-extrabold">출석 확인</button><button type="button" onClick={()=>openCompose('message')} className="h-11 flex-1 rounded-xl bg-primary text-[12px] font-extrabold">메시지</button></div>}

    {compose&&<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35" onClick={()=>setCompose(null)}><section role="dialog" aria-modal="true" aria-label={compose==='message'?'선택 근무자 메시지':'선택 근무자 출석 확인'} onClick={(event)=>event.stopPropagation()} className="w-full max-w-xl rounded-t-3xl bg-white p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[11px] font-extrabold text-primary">선택 {selected.size}명</p><h2 className="mt-1 text-[20px] font-extrabold text-ink">{compose==='message'?'개인 메시지 보내기':'출석 확인 요청'}</h2><p className="mt-1 text-[12px] text-sub">각 근무자의 비공개 대화로 따로 전달돼요.</p></div><button type="button" onClick={()=>setCompose(null)} className="px-2 text-[22px] text-sub">×</button></div><textarea autoFocus value={body} onChange={(event)=>setBody(event.target.value)} maxLength={compose==='check'?500:2000} rows={4} className="mt-4 w-full resize-none rounded-2xl border border-line bg-bg px-4 py-3 text-[14px] text-ink outline-none" placeholder="전달할 내용을 입력하세요"/>{compose==='check'&&<label className="mt-3 block text-[11px] font-bold text-sub">확인 기한 · 선택<input type="datetime-local" value={dueAt} onChange={(event)=>setDueAt(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-[13px]"/></label>}{error&&<p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] font-bold text-red-600">{error}</p>}<button type="button" onClick={()=>void submitBulk()} disabled={sending||!body.trim()} className="mt-4 h-12 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white disabled:opacity-40">{sending?'보내는 중...':`${selected.size}명에게 보내기`}</button></section></div>}
  </>;
}
