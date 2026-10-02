'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GigActionForm } from './GigActionForm';
import type { GigProject } from '@/lib/db/gig-projects';

const inputClass = 'mt-2 h-12 w-full rounded-xl border border-line bg-white px-3 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';
const WEEKDAYS: [number, string][] = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [7, '일']];
function todayKST() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }

// 근무 건 만들기/수정. 하루짜리 행사면 날짜 하나, 반복이면 기간 + 요일. 급여는 근무 건 시급 하나로 정한다.
export function GigProjectForm({ mode, project }: { mode: 'create' | 'edit'; project?: GigProject }) {
  const router = useRouter();
  const single = project ? project.startsOn === project.endsOn : true;
  const [scheduleMode, setScheduleMode] = useState<'single' | 'repeat'>(single ? 'single' : 'repeat');
  const [startsOn, setStartsOn] = useState(project?.startsOn ?? todayKST());
  const [endsOn, setEndsOn] = useState(project?.endsOn ?? todayKST());
  const [weekdays, setWeekdays] = useState<number[]>(project?.workWeekdays ?? [1, 2, 3, 4, 5]);

  return <GigActionForm kind={mode === 'create' ? 'create' : 'update'} values={project ? { project_id: project.id } : undefined}
    successMessage={mode === 'edit' ? '근무 건을 수정했어요. 참여자 일정도 함께 바뀌었어요.' : undefined}
    onSuccess={(data) => { if (mode === 'create') router.push(`/gig-work/${(data as { projectId: string }).projectId}`); }}>
    <label className="block text-label font-medium text-sub">근무 이름<input name="title" required maxLength={120} defaultValue={project?.title ?? ''} className={inputClass} placeholder="예: 주말 팝업 행사, 매장 보조" /></label>

    <section className="mt-5 rounded-2xl bg-bg p-4">
      <h3 className="text-[0.8125rem] font-extrabold text-ink">언제 하나요?</h3>
      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="근무 일정 방식">
        <button type="button" onClick={() => { setScheduleMode('single'); setEndsOn(startsOn); }} aria-pressed={scheduleMode === 'single'} className={`h-11 rounded-xl text-[0.8125rem] font-extrabold ${scheduleMode === 'single' ? 'bg-primary text-white' : 'border border-line bg-white text-sub'}`}>하루 · 단기 행사</button>
        <button type="button" onClick={() => setScheduleMode('repeat')} aria-pressed={scheduleMode === 'repeat'} className={`h-11 rounded-xl text-[0.8125rem] font-extrabold ${scheduleMode === 'repeat' ? 'bg-primary text-white' : 'border border-line bg-white text-sub'}`}>기간 · 반복 근무</button>
      </div>
      {scheduleMode === 'single' ? <div className="mt-4">
        <label className="text-label font-medium text-sub">근무 날짜<input name="starts_on" type="date" required value={startsOn} onChange={(event) => { setStartsOn(event.target.value); setEndsOn(event.target.value); }} className={inputClass} /></label>
        <input type="hidden" name="ends_on" value={startsOn} />
      </div> : <>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-label font-medium text-sub">시작일<input name="starts_on" type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className={inputClass} /></label>
          <label className="text-label font-medium text-sub">종료일<input name="ends_on" type="date" required value={endsOn} min={startsOn} onChange={(event) => setEndsOn(event.target.value)} className={inputClass} /></label>
        </div>
        <fieldset className="mt-4"><legend className="mb-2 text-label font-medium text-sub">반복 요일</legend>
          <div className="grid grid-cols-7 gap-1.5">{WEEKDAYS.map(([day, label]) => <label key={day} className={`flex h-10 cursor-pointer items-center justify-center rounded-xl text-[0.8125rem] font-bold ${weekdays.includes(day) ? 'bg-ink text-white' : 'border border-line bg-white text-sub'}`}><input type="checkbox" name="work_weekdays" value={day} checked={weekdays.includes(day)} onChange={(event) => setWeekdays((current) => event.target.checked ? [...current, day] : current.filter((item) => item !== day))} className="sr-only" />{label}</label>)}</div>
        </fieldset>
      </>}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-label font-medium text-sub">출근시간<input name="start_time" type="time" required defaultValue={project?.startTime.slice(0, 5) ?? '10:00'} className={inputClass} /></label>
        <label className="text-label font-medium text-sub">퇴근시간<input name="end_time" type="time" required defaultValue={project?.endTime.slice(0, 5) ?? '18:00'} className={inputClass} /></label>
      </div>
      <label className="mt-4 block text-label font-medium text-sub">휴게시간<select name="break_minutes" defaultValue={String(project?.breakMinutes ?? 60)} className={inputClass}><option value="0">없음</option><option value="30">30분</option><option value="60">1시간</option><option value="90">1시간 30분</option><option value="120">2시간</option></select></label>
    </section>

    <section className="mt-5 grid grid-cols-2 gap-3">
      <label className="text-label font-medium text-sub">시급 <span className="font-normal text-tertiary">· 이 근무 공통</span><input name="pay_rate" type="number" min="0" step="100" defaultValue={project?.payRate ?? ''} className={inputClass} placeholder="예: 15000" /></label>
      <label className="text-label font-medium text-sub">필요 인원<input name="headcount" type="number" min="1" max="200" required defaultValue={project?.headcount ?? 1} className={inputClass} /></label>
      <label className="col-span-2 text-label font-medium text-sub">메모 <span className="font-normal text-tertiary">· 선택, 관리자만 봄</span><input name="note" maxLength={500} defaultValue={project?.note ?? ''} className={inputClass} placeholder="예: 행사장 2층 안내데스크 집합" /></label>
    </section>

    <button className="mt-6 h-12 w-full rounded-xl bg-ink font-bold text-white disabled:opacity-40">{mode === 'create' ? '근무 만들기 → 근무자 잇기' : '수정 저장'}</button>
  </GigActionForm>;
}
