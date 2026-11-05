'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GigActionForm } from './GigActionForm';
import { GigInviteBatchForm } from './GigInviteBatchForm';
import { CopyInviteButton } from '@/app/staff/CopyInviteButton';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { UnlinkWorkerButton } from '@/app/staff/UnlinkWorkerButton';
import type { GigCandidate, GigProject } from '@/lib/db/gig-projects';

const STATUS: Record<string, [string, string]> = {
  working: ['근무 중', 'bg-emerald-50 text-emerald-700'], late: ['지각 · 근무 중', 'bg-amber-50 text-amber-700'],
  checkout_pending: ['조기 퇴근 승인', 'bg-amber-50 text-amber-700'], completed: ['오늘 완료', 'bg-bg text-sub'], absent: ['결근', 'bg-red-50 text-red-600'],
};

// 근무 건의 참여자. 기존 긱 근무자를 고르거나 새 사람을 바로 초대한다(여러 명 한 번에 가능).
export function GigParticipantsPanel({ project, candidates, workerOrigin }: { project: GigProject; candidates: GigCandidate[]; workerOrigin: string }) {
  // '등록된 근무자 잇기'로 마지막 후보를 넣으면 폼이 사라지므로, 출근 시간 안내(notice)는 패널에 남긴다
  const [addNotice, setAddNotice] = useState('');
  return <section className="mt-4 rounded-2xl bg-white p-5 shadow-card">
    <div className="flex items-end justify-between"><div><p className="text-[0.6875rem] font-bold text-primary">누가 하나요?</p><h2 className="mt-0.5 text-[1.125rem] font-extrabold text-ink">참여자 {project.participants.length}명</h2></div><span className="text-[0.75rem] text-sub">필요 {project.headcount}명</span></div>

    {project.participants.length === 0 ? <p className="mt-3 rounded-xl bg-bg px-4 py-6 text-center text-[0.8125rem] text-sub">아직 아무도 없어요. 아래에서 잇기로 넣어 주세요.</p>
      : <ul className="mt-3 divide-y divide-line">{project.participants.map((member) => {
        const status = member.todayStatus ? STATUS[member.todayStatus] : null;
        return <li key={member.assignmentId} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><b className="text-[0.9375rem] text-ink">{member.name}</b>
              {status ? <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-extrabold ${status[1]}`}>{status[0]}</span>
                : member.workerLinked ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-extrabold text-primary">이어짐</span>
                : member.invitePending ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[0.6875rem] font-extrabold text-violet-700">잇기 대기</span>
                : <span className="rounded-full bg-bg px-2 py-0.5 text-[0.6875rem] font-extrabold text-sub">잇기 링크 필요</span>}
            </div>
            {member.workerLinked && member.accountName && member.accountName !== member.name && <p className="mt-0.5 text-[0.6875rem] font-bold text-warn">수락한 계정: {member.accountName} · 본인 확인</p>}
            {member.workerLinked && <div className="mt-1"><UnlinkWorkerButton staffId={member.staffId} name={member.name} accountName={member.accountName} inviteUrlBase={`${workerOrigin}/gig/join`} align="start" /></div>}
            {!member.workerLinked && member.inviteToken && <div className="mt-1 flex flex-wrap items-center gap-3"><CopyInviteButton url={`${workerOrigin}/gig/join?token=${member.inviteToken}`} /><WorkforceActionForm kind="create_invite" values={{ staff_id: member.staffId }} successMessage="이전 링크를 끄고 새 초대를 만들었어요."><button className="inline-flex min-h-10 items-center px-1 text-[0.6875rem] font-bold text-sub">재발급</button></WorkforceActionForm></div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {member.workerLinked && <Link href={`/workroom?staff=${member.staffId}`} className="inline-flex min-h-10 items-center rounded-lg bg-bg px-3 text-[0.6875rem] font-extrabold text-primary">대화</Link>}
            <GigActionForm kind="remove_participant" values={{ assignment_id: member.assignmentId }} confirmText={`${member.name}님을 이 근무에서 뺄까요?`}><button className="min-h-10 rounded-lg px-3 text-[0.6875rem] font-bold text-sub">빼기</button></GigActionForm>
          </div>
        </li>;
      })}</ul>}

    {candidates.length > 0 && <GigActionForm kind="add_participants" values={{ project_id: project.id }} successMessage="근무에 넣었어요." onSuccess={(data) => { const note = (data as { notice?: unknown } | null)?.notice; setAddNotice(typeof note === 'string' ? note : ''); }} className="mt-4 rounded-xl bg-bg p-3">
      <p className="text-[0.75rem] font-extrabold text-ink">등록된 근무자 잇기</p>
      <div className="mt-2 flex flex-wrap gap-2">{candidates.map((candidate) => <label key={candidate.staffId} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[0.8125rem] font-bold text-ink"><input type="checkbox" name="staff_ids" value={candidate.staffId} className="h-4 w-4 accent-primary" />{candidate.name}{!candidate.workerLinked && <span className="text-[0.6875rem] font-medium text-sub">· 초대 전</span>}</label>)}</div>
      <button className="mt-3 h-10 w-full rounded-xl bg-ink text-[0.75rem] font-extrabold text-white">선택한 사람 잇기</button>
    </GigActionForm>}

    {addNotice && candidates.length === 0 && <p role="status" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[0.75rem] font-bold leading-5 text-amber-800">{addNotice}</p>}
    <GigInviteBatchForm projectId={project.id} workerOrigin={workerOrigin} />
  </section>;
}
