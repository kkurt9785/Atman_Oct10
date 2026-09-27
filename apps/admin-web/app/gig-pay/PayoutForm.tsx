'use client';

import { useState, useTransition } from 'react';
import { cancelGigPayoutAction, createGigPayoutAction, markGigPayoutPaidAction } from './actions';

function todayKST() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function plusDays(days: number) { return new Date(Date.now() + 9 * 60 * 60 * 1000 + days * 86_400_000).toISOString().slice(0, 10); }

// 근무자 한 명의 '지금 지급 / 나중에 지급' 버튼. 금액은 서버가 다시 계산하므로 여기서는 보여주기만 한다.
export function CreatePayoutForm({ staffId, amount, disabled }: { staffId: string; amount: number; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [later, setLater] = useState(false);
  const [payAt, setPayAt] = useState(plusDays(7));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  function submit(mode: 'now' | 'later') {
    setError(''); setDone('');
    const form = new FormData();
    form.set('staff_id', staffId); form.set('mode', mode); form.set('pay_at', payAt); form.set('note', note);
    start(async () => {
      try {
        await createGigPayoutAction(form);
        setDone(mode === 'now' ? '지급 완료로 기록하고 근무자에게 알렸어요.' : `${payAt} 지급 예정으로 기록했어요.`);
        setLater(false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '처리하지 못했어요.');
      }
    });
  }

  return <div className="mt-3">
    {!later ? (
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || pending} onClick={() => submit('now')} className="h-11 rounded-xl bg-primary text-[13px] font-extrabold text-white disabled:opacity-40">{pending ? '기록 중...' : `지금 지급 완료 · ${amount.toLocaleString('ko-KR')}원`}</button>
        <button type="button" disabled={disabled || pending} onClick={() => setLater(true)} className="h-11 rounded-xl border border-line bg-white text-[13px] font-extrabold text-ink disabled:opacity-40">나중에 지급</button>
      </div>
    ) : (
      <div className="rounded-xl bg-bg p-3">
        <label className="block text-[11px] font-bold text-sub">지급 예정일<input type="date" value={payAt} min={todayKST()} onChange={(event) => setPayAt(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-[13px]" /></label>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px] font-bold">
          {[['내일', 1], ['이번 주', 7], ['2주 뒤', 14]].map(([label, days]) => <button key={String(label)} type="button" onClick={() => setPayAt(plusDays(Number(days)))} className="h-8 rounded-lg bg-white text-sub">{label}</button>)}
        </div>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={80} placeholder="메모 (선택) · 예: 매주 금요일 정산" className="mt-2 h-10 w-full rounded-xl border border-line bg-white px-3 text-[12px]" />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setLater(false)} className="h-10 rounded-xl bg-white text-[12px] font-bold text-sub">취소</button>
          <button type="button" disabled={pending} onClick={() => submit('later')} className="h-10 rounded-xl bg-ink text-[12px] font-extrabold text-white disabled:opacity-40">{pending ? '기록 중...' : '지급 예정으로 기록'}</button>
        </div>
      </div>
    )}
    {error && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{error}</p>}
    {done && <p role="status" className="mt-2 text-[12px] font-bold text-emerald-600">{done}</p>}
  </div>;
}

export function PayoutRowActions({ payoutId }: { payoutId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  function run(action: (form: FormData) => Promise<void>) {
    setError('');
    const form = new FormData(); form.set('payout_id', payoutId);
    start(async () => { try { await action(form); } catch (caught) { setError(caught instanceof Error ? caught.message : '처리하지 못했어요.'); } });
  }
  return <div className="flex items-center gap-1.5">
    <button type="button" disabled={pending} onClick={() => run(markGigPayoutPaidAction)} className="h-8 rounded-lg bg-primary px-3 text-[11px] font-extrabold text-white disabled:opacity-40">지급 완료</button>
    <button type="button" disabled={pending} onClick={() => run(cancelGigPayoutAction)} className="h-8 rounded-lg bg-white px-2 text-[11px] font-bold text-sub disabled:opacity-40">취소</button>
    {error && <span className="text-[11px] font-bold text-red-600">{error}</span>}
  </div>;
}
