'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GigActionForm } from './GigActionForm';
import { CopyInviteButton } from '@/app/staff/CopyInviteButton';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { UnlinkWorkerButton } from '@/app/staff/UnlinkWorkerButton';
import type { GigCandidate, GigProject } from '@/lib/db/gig-projects';

const STATUS: Record<string, [string, string]> = {
  working: ['근무 중', 'bg-emerald-50 text-emerald-700'], late: ['지각 · 근무 중', 'bg-amber-50 text-amber-700'],
  checkout_pending: ['조기 퇴근 승인', 'bg-amber-50 text-amber-700'], completed: ['오늘 완료', 'bg-bg text-sub'], absent: ['결근', 'bg-red-50 text-red-600'],
};

// 근무 건의 참여자. 기존 긱 근무자를 고르거나 새 사람을 바로 초대한다.
export function GigParticipantsPanel({ project, candidates, workerOrigin }: { project: GigProject; candidates: GigCandidate[]; workerOrigin: string }) {
  const [inviteUrl, setInviteUrl] = useState('');
  const [invitedName, setInvitedName] = useState('');
  return <section className="mt-4 rounded-2xl bg-white p-5 shadow-card">
    <div className="flex items-end justify-between"><div><p className="text-[11px] font-bold text-primary">누가 하나요?</p><h2 className="mt-0.5 text-[18px] font-extrabold text-ink">참여자 {project.participants.length}명</h2></div><span className="text-[12px] text-sub">필요 {project.headcount}명</span></div>

    {project.participants.length === 0 ? <p className="mt-3 rounded-xl bg-bg px-4 py-6 text-center text-[13px] text-sub">아직 아무도 없어요. 아래에서 잇기로 넣어 주세요.</p>
      : <ul className="mt-3 divide-y divide-line">{project.participants.map((member) => {
        const status = member.todayStatus ? STATUS[member.todayStatus] : null;
        return <li key={member.assignmentId} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><b className="text-[15px] text-ink">{member.name}</b>
              {status ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${status[1]}`}>{status[0]}</span>
                : member.workerLinked ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold text-primary">이어짐</span>
                : member.invitePending ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-extrabold text-violet-700">잇기 대기</span>
                : <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] font-extrabold text-sub">잇기 링크 필요</span>}
            </div>
            {member.workerLinked && member.accountName && member.accountName !== member.name && <p className="mt-0.5 text-[11px] font-bold text-warn">수락한 계정: {member.accountName} · 본인 확인</p>}
            {member.workerLinked && <div className="mt-1"><UnlinkWorkerButton staffId={member.staffId} name={member.name} accountName={member.accountName} inviteUrlBase={`${workerOrigin}/gig/join`} align="start" /></div>}
            {!member.workerLinked && member.inviteToken && <div className="mt-1 flex flex-wrap items-center gap-3"><CopyInviteButton url={`${workerOrigin}/gig/join?token=${member.inviteToken}`} /><WorkforceActionForm kind="create_invite" values={{ staff_id: member.staffId }} successMessage="이전 링크를 끄고 새 초대를 만들었어요."><button className="text-[11px] font-bold text-sub">재발급</button></WorkforceActionForm></div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {member.workerLinked && <Link href={`/workroom?staff=${member.staffId}`} className="rounded-lg bg-bg px-3 py-2 text-[11px] font-extrabold text-primary">대화</Link>}
            <GigActionForm kind="remove_participant" values={{ assignment_id: member.assignmentId }} confirmText={`${member.name}님을 이 근무에서 뺄까요?`}><button className="rounded-lg px-2 py-2 text-[11px] font-bold text-sub">빼기</button></GigActionForm>
          </div>
        </li>;
      })}</ul>}

    {candidates.length > 0 && <GigActionForm kind="add_participants" values={{ project_id: project.id }} successMessage="근무에 넣었어요." className="mt-4 rounded-xl bg-bg p-3">
      <p className="text-[12px] font-extrabold text-ink">등록된 근무자 잇기</p>
      <div className="mt-2 flex flex-wrap gap-2">{candidates.map((candidate) => <label key={candidate.staffId} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-bold text-ink"><input type="checkbox" name="staff_ids" value={candidate.staffId} className="h-4 w-4 accent-primary" />{candidate.name}{!candidate.workerLinked && <span className="text-[10px] font-medium text-sub">· 초대 전</span>}</label>)}</div>
      <button className="mt-3 h-10 w-full rounded-xl bg-ink text-[12px] font-extrabold text-white">선택한 사람 잇기</button>
    </GigActionForm>}

    <GigActionForm kind="invite_participant" values={{ project_id: project.id }} resetOnSuccess className="mt-3 rounded-xl border border-line p-3"
      onSuccess={(raw) => { const result = (raw ?? {}) as { inviteToken?: string | null }; setInvitedName('등록했어요 · 근무자가 직접 수락할 초대를 보내 주세요'); setInviteUrl(result.inviteToken ? `${workerOrigin}/gig/join?token=${result.inviteToken}` : ''); }}>
      <p className="text-[12px] font-extrabold text-ink">새 사람 잇기 (초대)</p>
      <p className="mt-1 text-[11px] leading-4 text-sub">이 근무 일정·시급으로 등록되고 일회용 초대가 만들어져요. 전화번호는 선택 정보이며 자동 연결에 사용하지 않아요.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input name="name" required maxLength={80} placeholder="이름" className="h-11 rounded-xl border border-line bg-white px-3 text-[13px]" />
        <input name="phone" inputMode="tel" placeholder="휴대전화 · 선택" className="h-11 rounded-xl border border-line bg-white px-3 text-[13px]" />
      </div>
      <button className="mt-2 h-10 w-full rounded-xl bg-primary text-[12px] font-extrabold text-white">등록하고 일회용 초대 만들기</button>
      {invitedName && <div className="mt-3 rounded-xl border border-success/30 bg-success/5 p-3"><p className="text-[12px] font-extrabold text-ink">{invitedName}</p>{inviteUrl && <div className="mt-2"><CopyInviteButton url={inviteUrl} primary /></div>}</div>}
    </GigActionForm>
  </section>;
}
