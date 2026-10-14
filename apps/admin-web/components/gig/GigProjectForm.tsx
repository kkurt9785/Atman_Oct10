'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GigActionForm } from './GigActionForm';
import type { GigProject } from '@/lib/db/gig-projects';
import { MIN_HOURLY_WAGE_2026, calcBreakMinutes, weeklyHolidayPay } from '@/lib/pay';

const inputClass = 'mt-2 h-12 w-full rounded-xl border border-line bg-white px-3 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';
const WEEKDAYS: [number, string][] = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [7, '일']];
function todayKST() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
const hoursText = (m: number) => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
function spanMinutes(start: string, end: string) {
  const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  let total = eh * 60 + em - (sh * 60 + sm); if (total <= 0) total += 24 * 60; return total;
}

// 근무 건 만들기/수정. 하루짜리 행사면 날짜 하나, 반복이면 기간 + 요일. 급여는 근무 건 시급 하나로 정한다.
export function GigProjectForm({ mode, project }: { mode: 'create' | 'edit'; project?: GigProject }) {
  const router = useRouter();
  const single = project ? project.startsOn === project.endsOn : true;
  const [scheduleMode, setScheduleMode] = useState<'single' | 'repeat'>(single ? 'single' : 'repeat');
  const [startsOn, setStartsOn] = useState(project?.startsOn ?? todayKST());
  const [endsOn, setEndsOn] = useState(project?.endsOn ?? todayKST());
  const [weekdays, setWeekdays] = useState<number[]>(project?.workWeekdays ?? [1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState(project?.startTime.slice(0, 5) ?? '10:00');
  const [endTime, setEndTime] = useState(project?.endTime.slice(0, 5) ?? '18:00');
  // 휴게는 근무시간에 맞춰 자동(4h↑ 30분·8h↑ 60분, 법정 최소) — 사장님이 직접 고르면 그 값을 쓴다
  const [breakTouched, setBreakTouched] = useState(Boolean(project));
  const [breakMinutes, setBreakMinutes] = useState(project?.breakMinutes ?? calcBreakMinutes(spanMinutes('10:00', '18:00')));
  const [payRate, setPayRate] = useState<string>(project?.payRate ? String(project.payRate) : '');
  const [headcount, setHeadcount] = useState<string>(String(project?.headcount ?? 1));
  const span = spanMinutes(startTime, endTime);
  const autoBreak = calcBreakMinutes(span);
  const effectiveBreak = breakTouched ? breakMinutes : autoBreak;
  const workMinutes = Math.max(0, span - effectiveBreak);
  const rate = Number(payRate) || 0;
  const people = Math.max(1, Number(headcount) || 1);
  const dailyPay = Math.round((workMinutes / 60) * rate);
  const daysPerWeek = scheduleMode === 'single' ? 1 : weekdays.length;
  const weeklyMinutes = workMinutes * daysPerWeek;
  const holiday = scheduleMode === 'repeat' ? weeklyHolidayPay(weeklyMinutes, rate) : 0;

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
        <label className="text-label font-medium text-sub">출근시간<input name="start_time" type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} className={inputClass} /></label>
        <label className="text-label font-medium text-sub">퇴근시간<input name="end_time" type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} className={inputClass} /></label>
      </div>
      <label className="mt-4 block text-label font-medium text-sub">휴게시간 <span className="font-normal text-tertiary">· {breakTouched ? '직접 선택' : `근무 ${hoursText(span)} 기준 자동`}</span><select name="break_minutes" value={String(effectiveBreak)} onChange={(event) => { setBreakTouched(true); setBreakMinutes(Number(event.target.value)); }} className={inputClass}><option value="0">없음</option><option value="30">30분</option><option value="60">1시간</option><option value="90">1시간 30분</option><option value="120">2시간</option></select></label>
    </section>

    <section className="mt-5 grid grid-cols-2 gap-3">
      <label className="text-label font-medium text-sub">시급 <span className="font-normal text-tertiary">· 이 근무 공통</span><input name="pay_rate" type="number" min={MIN_HOURLY_WAGE_2026} step="100" value={payRate} onChange={(event) => setPayRate(event.target.value)} className={inputClass} placeholder={`${MIN_HOURLY_WAGE_2026.toLocaleString('ko-KR')} 이상`} /></label>
      <label className="text-label font-medium text-sub">필요 인원<input name="headcount" type="number" min="1" max="200" required value={headcount} onChange={(event) => setHeadcount(event.target.value)} className={inputClass} /></label>
      <div className="col-span-2 rounded-xl bg-bg p-3 text-[0.75rem] leading-5 text-sub" aria-live="polite">
        {rate > 0 && rate < MIN_HOURLY_WAGE_2026 && <p className="font-bold text-red-600">2026년 최저시급 {MIN_HOURLY_WAGE_2026.toLocaleString('ko-KR')}원보다 적어요. (2027년부터 10,700원)</p>}
        <p>하루 {hoursText(workMinutes)} 근무{effectiveBreak > 0 ? ` (휴게 ${effectiveBreak}분 뺀 시간)` : ''}{rate > 0 ? <> · 1인 <b className="text-ink">{won(dailyPay)}</b>{people > 1 ? <> · {people}명 <b className="text-ink">{won(dailyPay * people)}</b></> : null}</> : ' · 시급을 넣으면 하루 금액이 보여요'}</p>
        {scheduleMode === 'repeat' && rate > 0 && (holiday > 0
          ? <p className="mt-1">주 {daysPerWeek}일 {hoursText(weeklyMinutes)} → 개근한 주는 <b className="text-ink">주휴수당 약 {won(holiday)}</b>이 별도로 생겨요 (주 15시간 이상, 1인 기준).</p>
          : <p className="mt-1">주 {daysPerWeek}일 {hoursText(weeklyMinutes)} · 주 15시간 미만이라 주휴수당은 없어요.</p>)}
        <p className="mt-1 text-tertiary">야간(22~06시)·연장 가산은 5인 이상 사업장에만 적용돼요. 금액 확정은 세무사·노무사와 확인해 주세요.</p>
      </div>
      <label className="col-span-2 text-label font-medium text-sub">메모 <span className="font-normal text-tertiary">· 선택, 관리자만 봄</span><input name="note" maxLength={500} defaultValue={project?.note ?? ''} className={inputClass} placeholder="예: 행사장 2층 안내데스크 집합" /></label>
    </section>

    <button className="mt-6 h-12 w-full rounded-xl bg-ink font-bold text-white disabled:opacity-40">{mode === 'create' ? '근무 만들기 → 근무자 잇기' : '수정 저장'}</button>
  </GigActionForm>;
}
