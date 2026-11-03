'use client';

import { useState, useTransition } from 'react';
import { setFacilityPublicFlagsAction, type FacilityPublicFlags } from '@/lib/actions/platform';

// 직업안정법 §25 — 사업장 한 곳의 공표 정보(체불사업주 명단·산재 공표) 대조 결과를 기록한다.
export function PublicFlagsCard({ facility: f }: { facility: FacilityPublicFlags }) {
  const [wage, setWage] = useState(f.public_flag_wage_arrears);
  const [accident, setAccident] = useState(f.public_flag_industrial_accident);
  const [note, setNote] = useState(f.public_flags_note ?? '');
  const [checkedAt, setCheckedAt] = useState(f.public_flags_checked_at);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const stale = !checkedAt || Date.now() - Date.parse(checkedAt) > 35 * 86_400_000; // 월 1회 대조 기준

  function save() {
    setMessage(null);
    startTransition(async () => {
      const r = await setFacilityPublicFlagsAction({ facilityId: f.id, wageArrears: wage, industrialAccident: accident, note });
      if (r.ok) { setCheckedAt(new Date().toISOString()); setMessage('저장했어요. 근무자 화면에 바로 반영돼요.'); }
      else setMessage(r.error ?? '저장하지 못했어요.');
    });
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.875rem] font-bold text-ink">{f.name}</p>
          <p className="truncate text-[0.75rem] text-sub">{f.business_registration_number ?? '등록번호 없음'} · {checkedAt ? `대조 ${new Date(checkedAt).toLocaleDateString('ko-KR')}` : '아직 대조 안 함'}</p>
        </div>
        {stale && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-bold text-amber-700">대조 필요</span>}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-[0.8125rem]">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={wage} onChange={(e) => setWage(e.target.checked)} disabled={isPending} />체불사업주 명단 공개 중</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={accident} onChange={(e) => setAccident(e.target.checked)} disabled={isPending} />산재 발생건수 공표 사업장</label>
      </div>
      <div className="mt-1 flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="대조 메모 (예: 2026-11 명단 없음)" aria-label={`${f.name} 대조 메모`} className="h-11 min-w-0 flex-1 rounded-xl border border-line px-3 text-[0.8125rem] outline-none focus:border-primary" />
        <button type="button" onClick={save} disabled={isPending} className="h-11 shrink-0 rounded-xl bg-primary px-4 text-[0.8125rem] font-bold text-white disabled:opacity-50">{isPending ? '저장 중' : '대조 완료로 저장'}</button>
      </div>
      {message && <p role="status" className="mt-1 text-[0.75rem] font-bold text-sub">{message}</p>}
    </li>
  );
}
