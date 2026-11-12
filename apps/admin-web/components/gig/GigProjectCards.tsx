import Link from 'next/link';
import { projectRunsOn, projectScheduleText, type GigProject } from '@/lib/db/gig-projects';

// 근무 건 카드 목록. 홈(오늘)과 근무 탭이 같이 쓴다(2026-11-12 탭 개편).
export function GigProjectCards({ projects, today, individuallyScheduled = 0 }: { projects: GigProject[]; today: string; individuallyScheduled?: number }) {
  const board = { today };
  return <>
    {projects.length===0?<Link href="/gig-work/new" className="mt-3 block rounded-2xl border-2 border-dashed border-line bg-white px-4 py-7 text-center active:bg-bg"><b className="text-[0.9375rem] text-ink">{individuallyScheduled>0?`한 명씩 등록한 근무자 ${individuallyScheduled}명의 일정이 있어요`:'첫 근무를 만들어 보세요'}</b><span className="mt-1 block text-[0.75rem] text-sub">{individuallyScheduled>0?'아래 7일 일정에서 볼 수 있어요. 여러 명을 한 번에 관리하려면 근무를 만들어 넣으세요.':'행사 하루든 매주 반복이든 하나 만들고 여러 명을 넣으면 돼요.'}</span></Link>
      :<div className="mt-3 grid gap-2 lg:grid-cols-2">{projects.map((project)=>{const today=projectRunsOn(project,board.today);const filled=project.participants.length;const working=project.participants.filter((p)=>p.todayStatus==='working'||p.todayStatus==='late').length;const pending=project.participants.filter((p)=>!p.workerLinked).length;return <Link key={project.id} href={`/gig-work/${project.id}`} className={`rounded-2xl border bg-white p-4 shadow-sm active:bg-bg ${today?'border-primary/40':'border-transparent'}`}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="text-[1rem] text-ink">{project.title}</b>{today&&<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-extrabold text-primary">오늘</span>}</div><p className="mt-1 text-[0.75rem] text-sub">{projectScheduleText(project)}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold ${filled>=project.headcount?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-700'}`}>{filled}/{project.headcount}명</span></div>
        <p className="mt-2 text-[0.6875rem] text-tertiary">{project.payRate?`시급 ${project.payRate.toLocaleString('ko-KR')}원`:'시급 미정'}{pending>0?` · 초대 대기 ${pending}명`:''}{today&&working>0?` · 근무 중 ${working}명`:''}{filled<project.headcount?` · ${project.headcount-filled}명 더 필요`:''}</p>
      </Link>;})}</div>}
  </>;
}
