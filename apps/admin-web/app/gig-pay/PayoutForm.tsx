'use client';

import { useRef, useState } from 'react';
import { cancelGigPayoutAction, createGigPayoutAction, markGigPayoutPaidAction } from './actions';
import { withholding } from '@/lib/withholding';

function todayKST() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function plusDays(days: number) { return new Date(Date.now() + 9 * 60 * 60 * 1000 + days * 86_400_000).toISOString().slice(0, 10); }
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

// 근무자 한 명의 '지금 지급 / 나중에 지급'. 3.3% 원천징수를 켜면 공제액과 실지급액을 바로 보여 준다. 금액은 서버가 다시 계산한다.
export function CreatePayoutForm({ staffId, amount, disabled, disabledReason }: { staffId: string; amount: number; disabled?: boolean; disabledReason?: string }) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [later, setLater] = useState(false);
  // 기본은 공제 없음 — 출퇴근을 정해 주고 시급을 주는 단기 알바는 근로자(일용근로소득)라 3.3%(사업소득)는 프리랜서 계약일 때만
  const [withhold, setWithhold] = useState(false);
  const [payAt, setPayAt] = useState(plusDays(7));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const tax = withholding(amount, withhold);

  async function submit(mode: 'now' | 'later') {
    if (busy.current || disabled) return;
    busy.current = true;
    setPending(true);
    setError(''); setDone('');
    const form = new FormData();
    form.set('expected_amount', String(amount));
    form.set('staff_id', staffId); form.set('mode', mode); form.set('pay_at', payAt); form.set('note', note); form.set('withhold', withhold ? '1' : '0');
    try {
      await createGigPayoutAction(form);
      setDone(mode === 'now' ? `실지급 ${won(tax.net)} 지급 완료로 기록했어요. 근무자 앱에서 내역을 확인할 수 있어요.` : `${payAt} 지급 예정(실지급 ${won(tax.net)})으로 기록했어요.`);
      setLater(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '처리하지 못했어요.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <div className="mt-3" aria-busy={pending}>
    {disabledReason && <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-center text-[0.75rem] font-bold text-amber-700">{disabledReason}</p>}
    <fieldset disabled={disabled || pending} className="min-w-0">
    <div className="rounded-xl bg-bg p-3">
      <label className="flex items-center justify-between gap-2 text-[0.75rem] font-bold text-ink">
        <span className="flex items-center gap-2"><input type="checkbox" checked={withhold} onChange={(event) => setWithhold(event.target.checked)} className="h-4 w-4 accent-primary" />3.3% 원천징수 (사업소득)</span>
        <span className="text-[0.6875rem] font-medium text-sub">프리랜서 계약일 때만</span>
      </label>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div><p className="text-[0.6875rem] text-sub">세전</p><p className="text-[0.8125rem] font-bold text-ink">{won(amount)}</p></div>
        <div><p className="text-[0.6875rem] text-sub">공제</p><p className="text-[0.8125rem] font-bold text-red-600">−{won(tax.total)}</p></div>
        <div><p className="text-[0.6875rem] text-sub">실지급</p><p className="text-[0.9375rem] font-extrabold text-primary">{won(tax.net)}</p></div>
      </div>
    </div>
    <p className="mt-2 text-[0.75rem] leading-5 text-sub">앱에서 송금하지 않아요. 실제 이체를 마친 뒤 완료로 기록해 주세요.</p>
    {!later ? (
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || pending} onClick={() => submit('now')} className="min-h-14 rounded-xl bg-primary px-3 py-2 text-[0.8125rem] font-extrabold leading-5 text-white disabled:opacity-40">{pending ? '기록 중...' : <>이체 완료 기록<span className="block">{won(tax.net)}</span></>}</button>
        <button type="button" disabled={disabled || pending} onClick={() => setLater(true)} className="min-h-14 rounded-xl border border-line bg-white px-3 py-2 text-[0.8125rem] font-extrabold text-ink disabled:opacity-40">나중에 지급</button>
      </div>
    ) : (
      <div className="mt-2 rounded-xl bg-bg p-3">
        <label className="block text-[0.6875rem] font-bold text-sub">지급 예정일<input type="date" value={payAt} min={todayKST()} onChange={(event) => setPayAt(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-[0.8125rem]" /></label>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[0.6875rem] font-bold">
          {[['내일', 1], ['7일 뒤', 7], ['2주 뒤', 14]].map(([label, days]) => <button key={String(label)} type="button" onClick={() => setPayAt(plusDays(Number(days)))} className="h-11 rounded-lg bg-white text-sub">{label}</button>)}
        </div>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={80} aria-label="지급 메모 (선택)" placeholder="메모 (선택) · 예: 매주 금요일 정산" className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-[0.75rem]" />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setLater(false)} className="h-11 rounded-xl bg-white text-[0.75rem] font-bold text-sub">취소</button>
          <button type="button" disabled={disabled || pending} onClick={() => submit('later')} className="h-11 rounded-xl bg-ink text-[0.75rem] font-extrabold text-white disabled:opacity-40">{pending ? '기록 중...' : '지급 예정으로 기록'}</button>
        </div>
      </div>
    )}
    </fieldset>
    {pending && <p role="status" className="mt-2 text-[0.75rem] font-bold text-sub">지급 기록을 저장 중이에요. 잠시만 기다려 주세요.</p>}
    {error && <p role="alert" className="mt-2 text-[0.75rem] font-bold text-red-600">{error}</p>}
    {done && <p role="status" className="mt-2 text-[0.75rem] font-bold text-emerald-600">{done}</p>}
  </div>;
}

export function PayoutRowActions({ payoutId }: { payoutId: string }) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function run(action: (form: FormData) => Promise<void>, message: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setDone('');
    const form = new FormData(); form.set('payout_id', payoutId);
    try { await action(form); setDone(message); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '처리하지 못했어요.'); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="flex flex-wrap items-center gap-1.5" aria-busy={pending}>
    <button type="button" disabled={pending} onClick={() => run(markGigPayoutPaidAction, '이체 완료로 기록했어요.')} className="min-h-11 rounded-lg bg-primary px-3 text-[0.75rem] font-extrabold text-white disabled:opacity-40">이체 완료 기록</button>
    <button type="button" disabled={pending} onClick={() => run(cancelGigPayoutAction, '지급 예정을 취소했어요.')} className="min-h-11 rounded-lg bg-white px-3 text-[0.75rem] font-bold text-sub disabled:opacity-40">예정 취소</button>
    {pending && <span role="status" className="w-full text-[0.75rem] text-sub">변경 사항을 저장 중이에요.</span>}
    {error && <span role="alert" className="w-full text-[0.75rem] font-bold text-red-600">{error}</span>}
    {done && <span role="status" className="w-full text-[0.75rem] font-bold text-emerald-600">{done}</span>}
  </div>;
}

// 세전 금액만 넣으면 3.3% 공제·실지급액이 바로 나오는 간이 계산기. 지급 기록과 무관하게 사장님이 아무 때나 두드려 본다.
export function WithholdingCalculator() {
  const [value, setValue] = useState('');
  const amount = Number(value.replace(/\D/g, '')) || 0;
  const tax = withholding(amount, true);
  return <section className="mt-6 rounded-2xl border border-line bg-white p-4 shadow-card">
    <div className="flex items-baseline justify-between"><h2 className="text-[0.9375rem] font-extrabold text-ink">3.3% 계산기</h2><span className="text-[0.6875rem] text-sub">세전 → 실지급</span></div>
    <div className="mt-3 flex items-center gap-2">
      <input inputMode="numeric" value={value ? amount.toLocaleString('ko-KR') : ''} onChange={(event) => setValue(event.target.value)} placeholder="세전 금액" aria-label="세전 금액" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-[0.9375rem] font-bold text-ink outline-none" />
      <span className="text-[0.8125rem] text-sub">원</span>
    </div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl bg-bg py-2"><p className="text-[0.6875rem] text-sub">소득세 3%</p><p className="text-[0.8125rem] font-bold text-ink">{won(tax.incomeTax)}</p></div>
      <div className="rounded-xl bg-bg py-2"><p className="text-[0.6875rem] text-sub">지방소득세 0.3%</p><p className="text-[0.8125rem] font-bold text-ink">{won(tax.localTax)}</p></div>
      <div className="rounded-xl bg-primary/10 py-2"><p className="text-[0.6875rem] text-primary">실지급</p><p className="text-[0.9375rem] font-extrabold text-primary">{won(tax.net)}</p></div>
    </div>
    <p className="mt-2 text-[0.6875rem] leading-4 text-sub">사업소득 3.3%의 간이 계산이에요. 근로소득에는 그대로 적용하지 마세요. 일용근로소득의 하루 15만원은 비과세 한도가 아닌 공제액이며, 소득 구분과 신고는 세무 담당자에게 확인해 주세요.</p>
  </section>;
}
