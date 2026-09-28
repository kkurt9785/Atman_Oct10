import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getShop } from '@/lib/db/shop';
import { getGigProject, listGigCandidates, projectScheduleText } from '@/lib/db/gig-projects';
import { ManageBackLink } from '@/components/ManageBackLink';
import { GigProjectForm } from '@/components/gig/GigProjectForm';
import { GigParticipantsPanel } from '@/components/gig/GigParticipantsPanel';
import { GigActionForm } from '@/components/gig/GigActionForm';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

// 근무 건 상세: 일정·시급 수정, 참여자 넣고 빼기, 초대 링크, 취소.
export default async function GigProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shop = await getShop();
  if (!shop) redirect('/setup/claim-facility');
  const [project, candidates] = await Promise.all([getGigProject(id), listGigCandidates(id)]);
  if (!project) notFound();
  const workerOrigin = process.env.NEXT_PUBLIC_WORKER_WEB_URL ?? (process.env.NODE_ENV === 'production' ? 'https://itdot.co.kr' : 'http://localhost:3003');
  const filled = project.participants.length;
  const cancelled = project.status === 'cancelled';

  return <main className="px-4 pb-28">
    <ManageBackLink href={shop.mode === 'gig' ? '/' : '/staff?view=contract'} label={shop.mode === 'gig' ? '운영' : '직원 관리'} />
    <section className="mt-3 rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[11px] font-extrabold text-primary-light">{cancelled ? '취소된 근무' : project.status === 'completed' ? '끝난 근무' : '근무 건'}</p><h1 className="mt-1 text-[24px] font-extrabold">{project.title}</h1><p className="mt-1 text-[13px] text-white/70">{projectScheduleText(project)}</p></div>
        <span className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-extrabold ${filled >= project.headcount ? 'bg-emerald-400/20 text-emerald-200' : 'bg-white/15 text-white'}`}>{filled}/{project.headcount}명</span>
      </div>
      <p className="mt-3 text-[12px] text-white/60">{project.payRate ? `시급 ${won(project.payRate)}` : '시급 미정'} · 휴게 {project.breakMinutes}분{project.note ? ` · ${project.note}` : ''}</p>
    </section>

    {!cancelled && <GigParticipantsPanel project={project} candidates={candidates} workerOrigin={workerOrigin} />}

    {!cancelled && <details className="mt-4 rounded-2xl bg-white shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-[14px] font-extrabold text-ink"><span>일정·시급 수정</span><span className="text-sub">⌄</span></summary>
      <div className="border-t border-line px-5 pb-5 pt-4"><GigProjectForm mode="edit" project={project} /></div>
    </details>}

    {!cancelled && <div className="mt-4 rounded-2xl border border-line bg-white p-4">
      <p className="text-[12px] leading-5 text-sub">취소하면 참여자의 남은 일정이 사라지고 워커 앱에서도 빠져요. 이미 기록된 출퇴근·지급은 그대로 남아요.</p>
      <GigActionForm kind="cancel" values={{ project_id: project.id }} confirmText={`'${project.title}' 근무를 취소할까요?`} successMessage="근무를 취소했어요."><button className="mt-3 h-11 w-full rounded-xl border border-red-200 bg-white text-[13px] font-extrabold text-red-600">이 근무 취소</button></GigActionForm>
    </div>}
    {cancelled && <Link href="/gig-work/new" className="mt-4 flex h-12 items-center justify-center rounded-xl bg-ink text-[14px] font-extrabold text-white">새 근무 만들기</Link>}
  </main>;
}
