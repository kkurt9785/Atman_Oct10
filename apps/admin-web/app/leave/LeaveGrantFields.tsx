'use client';

import { useState } from 'react';
import { suggestAnnualLeave } from '@/lib/annual-leave';

export type LeaveGrantStaff = { id: string; name: string; leaveDays: string; hireDate: string | null; regular: boolean };

const inputClass = 'mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white';

// '연차 일수 정하기' 입력칸(그 해에 줄 총 일수 — 남은 일수가 아니다). 정규 직원을 고르면 입사일로 따진 법정 연차를 참고로 보여 주고, 눌러야만 칸에 채운다(자동 부여 아님).
export function LeaveGrantFields({ staff, today }: { staff: LeaveGrantStaff[]; today: string }) {
  const thisYear = today.slice(0, 4);
  const [staffId, setStaffId] = useState('');
  const [year, setYear] = useState(thisYear);
  const [granted, setGranted] = useState('');
  const selected = staff.find((s) => s.id === staffId);
  const showHint = Boolean(selected?.regular) && year === thisYear;
  const suggestion = showHint ? suggestAnnualLeave(selected?.hireDate, today) : null;

  return <>
    <label className="col-span-2 text-label text-sub">직원<select name="staff_id" required value={staffId} onChange={(event) => setStaffId(event.target.value)} className={inputClass}><option value="">선택해 주세요</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name} · 남은 연차 {s.leaveDays}일</option>)}</select></label>
    <label className="text-label text-sub">연도<input name="leave_year" type="number" value={year} onChange={(event) => setYear(event.target.value)} className={inputClass}/></label>
    <label className="text-label text-sub">그 해에 줄 연차 일수<input name="granted_days" type="number" min="0" max="365" step="0.5" required value={granted} onChange={(event) => setGranted(event.target.value)} className={inputClass} placeholder="예: 15"/></label>
    {showHint && (suggestion ? (
      <div className="col-span-2 rounded-xl bg-white px-3 py-3">
        <p className="text-[0.8125rem] font-bold text-ink">법정 연차 참고: {suggestion.days}일</p>
        <p className="mt-1 text-[0.75rem] leading-5 text-sub">입사일 {selected?.hireDate?.replaceAll('-', '.')} 기준 · {suggestion.basis === 'monthly'
          ? `근무 ${suggestion.serviceMonths}개월(1년 미만은 한 달 개근마다 1일, 최대 11일)`
          : `근무 만 ${suggestion.serviceYears}년(1년 이상 15일, 3년부터 2년마다 1일씩 늘어 최대 25일)`}</p>
        <p className="mt-1 text-[0.6875rem] leading-4 text-tertiary">참고용이에요. 5인 미만 사업장·주 15시간 미만 근무는 법정 연차 대상이 아니고, 출근율·회계연도 기준에 따라 달라질 수 있어요.</p>
        <button type="button" onClick={() => setGranted(String(suggestion.days))} className="mt-2 h-11 w-full rounded-xl border border-primary/30 bg-primary/5 text-[0.8125rem] font-bold text-primary">{suggestion.days}일로 채우기</button>
      </div>
    ) : (
      <p className="col-span-2 rounded-xl bg-white px-3 py-3 text-[0.75rem] leading-5 text-sub">직원 관리에서 이 직원의 입사일을 넣으면, 여기서 법정 연차를 참고로 알려 드려요.</p>
    ))}
    <p className="col-span-2 text-[0.75rem] leading-5 text-sub">남은 일수가 아니라 그 해에 주는 전체 일수를 넣어 주세요. 이미 쓴 연차는 자동으로 빠져요.</p>
    <button className="col-span-2 h-12 rounded-xl bg-primary text-white font-bold">저장</button>
  </>;
}
