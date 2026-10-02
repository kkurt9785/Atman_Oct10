'use client';
import { useMemo, useState } from 'react';
import type { VacancyCandidate, VacancySource } from '@/lib/db/vacancy';
import { fillVacancyAction } from './actions';

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  invited: { text: '요청 보냄', className: 'bg-primary/10 text-primary' },
  applied: { text: '지원함', className: 'bg-primary/10 text-primary' },
  accepted: { text: '확정', className: 'bg-success/10 text-success' },
  cancelled: { text: '거절', className: 'bg-bg text-sub' },
  expired: { text: '마감', className: 'bg-bg text-sub' },
  rejected: { text: '마감', className: 'bg-bg text-sub' },
};

function SubmitButton({ count, makePublic, pending }: { count: number; makePublic: boolean; pending: boolean }) {
  const label = count > 0
    ? `${count}명에게 요청 보내기${makePublic ? ' · 공개 공고도' : ''}`
    : makePublic ? '공개 공고로 올리기' : '요청할 사람을 골라 주세요';
  return (
    <button disabled={pending || (count === 0 && !makePublic)} className="w-full min-h-12 rounded-xl bg-primary px-4 text-body font-extrabold text-white disabled:opacity-50">
      {pending ? '보내는 중…' : label}
    </button>
  );
}

function Row({ c, checked, onToggle, locked }: { c: VacancyCandidate; checked: boolean; onToggle: () => void; locked: boolean }) {
  const status = c.requestStatus ? STATUS_LABEL[c.requestStatus] : null;
  const selectable = !c.blockReason && !status && !locked && Boolean(c.workerId);
  const detail = c.blockReason
    ?? (locked ? 'Basic 이상 요금제에서 요청할 수 있어요'
      : c.kind === 'staff' ? '우리 직원' : `함께 일한 근무자${c.completedShiftCount ? ` · ${c.completedShiftCount}회` : ''}`);
  return (
    <label className={`flex min-h-14 items-center gap-3 px-4 py-2.5 ${selectable ? 'cursor-pointer active:bg-bg' : 'opacity-60'}`}>
      <input type="checkbox" name="worker_id" value={c.workerId ?? ''} checked={selectable && checked} onChange={onToggle} disabled={!selectable}
        className="h-5 w-5 shrink-0 accent-[#1B64DA]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-bold text-ink">{c.name}</span>
        <span className={`block truncate text-[0.75rem] ${c.blockReason ? 'text-sub' : 'text-tertiary'}`}>{detail}</span>
      </span>
      {status && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold ${status.className}`}>{status.text}</span>}
    </label>
  );
}

export function VacancyForm({ source, candidates, needsShift, defaultWage, defaultDescription, isPublic, poolLocked }: {
  source: VacancySource; candidates: VacancyCandidate[]; needsShift: boolean; defaultWage: number;
  defaultDescription: string; isPublic: boolean; poolLocked: boolean;
}) {
  const selectable = useMemo(() => candidates.filter((c) => !c.blockReason && !c.requestStatus && c.workerId && !(poolLocked && c.kind === 'pool')), [candidates, poolLocked]);
  // 요청할 수 있는 사람은 처음부터 모두 골라 둔다 — 대부분은 그대로 보내기만 하면 된다
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selectable.map((c) => c.workerId!)));
  const [makePublic, setMakePublic] = useState(!isPublic && selectable.length === 0 && candidates.every((c) => c.requestStatus == null));
  const staff = candidates.filter((c) => c.kind === 'staff');
  const pool = candidates.filter((c) => c.kind === 'pool');
  const toggle = (id: string | null) => id && setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const count = selectable.filter((c) => checked.has(c.workerId!)).length;
  const [pending, setPending] = useState(false);

  return (
    <form action={fillVacancyAction} onSubmit={() => setPending(true)} className="space-y-4">
      {source.mode === 'shift' && <input type="hidden" name="shift" value={source.shiftId} />}
      {source.mode === 'replace' && <input type="hidden" name="replace" value={source.shiftId} />}
      {source.mode === 'staff' && <><input type="hidden" name="staff" value={source.staffId} /><input type="hidden" name="date" value={source.date} /></>}
      {source.mode === 'rec' && <input type="hidden" name="rec" value={source.key} />}

      {needsShift && (
        <div className="rounded-2xl bg-white p-4 shadow-card">
          <label className="block text-label font-bold text-ink" htmlFor="vacancy-wage">시급</label>
          <div className="mt-2 flex items-center gap-2">
            <input id="vacancy-wage" name="hourly_wage" type="number" inputMode="numeric" min={10320} step={100} defaultValue={defaultWage} required className="h-12 w-full rounded-xl bg-bg px-4 text-body font-bold" />
            <span className="shrink-0 text-label text-sub">원</span>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[0.75rem] font-bold text-sub">업무 내용 고치기</summary>
            <textarea name="description" rows={2} defaultValue={defaultDescription} className="mt-2 w-full resize-none rounded-xl bg-bg px-4 py-3 text-label" />
          </details>
        </div>
      )}

      {staff.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-label font-bold text-sub">우리 직원</p>
          <div className="divide-y divide-line rounded-2xl bg-white shadow-card">
            {staff.map((c) => <Row key={`s:${c.staffId}`} c={c} checked={checked.has(c.workerId ?? '')} onToggle={() => toggle(c.workerId)} locked={false} />)}
          </div>
        </section>
      )}
      {pool.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-label font-bold text-sub">함께 일한 근무자</p>
          <div className="divide-y divide-line rounded-2xl bg-white shadow-card">
            {pool.map((c) => <Row key={`p:${c.workerId}`} c={c} checked={checked.has(c.workerId ?? '')} onToggle={() => toggle(c.workerId)} locked={poolLocked} />)}
          </div>
        </section>
      )}
      {candidates.length === 0 && (
        <p className="rounded-2xl bg-white p-5 text-center text-label text-sub shadow-card">같은 직군의 직원이나 함께 일한 근무자가 아직 없어요. 공개 공고로 올리면 근처 근무자에게 알림이 가요.</p>
      )}

      {!isPublic && (
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-4 shadow-card">
          <input type="checkbox" name="make_public" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#1B64DA]" />
          <span>
            <span className="block text-body font-bold text-ink">공개 공고로도 올리기</span>
            <span className="mt-0.5 block text-[0.75rem] leading-5 text-sub">근처 같은 직군 근무자에게 알림이 가고, 공고 링크를 카톡으로 보낼 수 있어요. 지원자는 확인 후 확정해요.</span>
          </span>
        </label>
      )}

      <div className="sticky bottom-20 space-y-2 pt-1">
        <SubmitButton count={count} makePublic={makePublic && !isPublic} pending={pending} />
        <p className="text-center text-[0.75rem] text-sub">요청받은 분 중 <b className="text-ink">먼저 수락한 분으로 바로 확정</b>돼요. 나머지 요청은 자동으로 닫혀요.</p>
      </div>
    </form>
  );
}
