'use client';
import { useId, useState } from 'react';
import { hoursText, periodText, sharePayoutStatement, won, type PayoutStatement } from '@/lib/gig-pay';

// 지급 한 건 — 누르면 '왜 이 금액인지'(시간 × 시급 − 공제)를 펼치고 명세를 공유한다
export type PayoutConfirm = { status: 'received' | 'missing' | null; onConfirm: (received: boolean) => Promise<string> };

export function PayoutDetail({ statement, right, confirm }: { statement: PayoutStatement; right?: React.ReactNode; confirm?: PayoutConfirm }) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  async function answer(received: boolean) {
    if (!confirm || confirming) return;
    setConfirming(true); setConfirmError('');
    const message = await confirm.onConfirm(received);
    setConfirming(false);
    if (message) setConfirmError(message);
  }
  const s = statement;
  async function share() {
    const text = await sharePayoutStatement(s);
    setNotice(text);
    if (text) setTimeout(() => setNotice(''), 1800);
  }
  return <div className="py-3">
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={detailId} className="min-h-[44px] min-w-0 flex-1 text-left active:opacity-70">
        <p className="text-[1.125rem] font-extrabold text-ink">{won(s.netAmount)} <span className="text-[0.75rem] font-bold text-sub">{open ? '명세 접기' : '명세 보기'} <span aria-hidden="true">{open ? '⌃' : '⌄'}</span></span></p>
        <p className="mt-0.5 text-[0.75rem] text-sub">{periodText(s.periodStart, s.periodEnd)} · {s.workedDays}일 · {hoursText(s.workedMinutes)}</p>
      </button>
      {right && <div className="shrink-0">{right}</div>}
    </div>
    {open && <div id={detailId} className="mt-3 rounded-xl bg-bg p-3 text-[0.8125rem] leading-5 text-ink">
      <dl className="divide-y divide-line">
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">계산</dt><dd className="text-right font-bold">{s.payBasis === 'hourly' ? `시급 ${won(s.payRate)} × ${hoursText(s.workedMinutes)}` : s.payBasis === 'daily' ? `일급 ${won(s.payRate)} × ${s.workedDays}일` : `월 정액 ${won(s.payRate)}`}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">세전</dt><dd className="font-bold">{won(s.amount)}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">공제</dt><dd className={`font-bold ${s.withholdingAmount > 0 ? 'text-red-600' : ''}`}>{s.withholdingAmount > 0 ? `사업소득 3.3% −${won(s.withholdingAmount)}` : '없음'}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">실지급</dt><dd className="text-[14px] font-extrabold text-primary">{won(s.netAmount)}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">{s.status === 'paid' ? '지급일' : '지급 예정일'}</dt><dd className="font-bold">{(s.status === 'paid' ? (s.paidAt ?? s.payAt ?? '') : (s.payAt ?? '')).slice(0, 10) || '-'}</dd></div>
      </dl>
      {confirm && s.status === 'paid' && (confirm.status === null
        ? <div className="mt-3">
            <p className="text-[0.75rem] font-bold text-sub">통장에 들어왔나요? 사장님 화면에 표시돼요.</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button type="button" disabled={confirming} onClick={() => void answer(true)} className="h-11 rounded-xl bg-primary text-[13px] font-extrabold text-white disabled:opacity-60">입금 확인했어요</button>
              <button type="button" disabled={confirming} onClick={() => void answer(false)} className="h-11 rounded-xl border border-line bg-white text-[13px] font-extrabold text-ink disabled:opacity-60">아직 안 들어왔어요</button>
            </div>
            {confirmError && <p role="alert" className="mt-1.5 text-[0.75rem] font-bold text-red-600">{confirmError}</p>}
          </div>
        : <p className={`mt-3 rounded-xl px-3 py-2 text-[12px] font-bold ${confirm.status === 'received' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{confirm.status === 'received' ? '입금 확인했어요 ✓' : '아직 못 받았다고 사장님께 표시했어요. 대화 탭에서 한 번 더 말씀드려도 좋아요.'}</p>)}
      <button type="button" onClick={() => void share()} className="mt-3 h-11 w-full rounded-xl border border-primary/30 bg-white text-[13px] font-extrabold text-primary active:opacity-80">명세 공유 · 복사</button>
      {notice && <p role="status" className="mt-2 text-center text-[0.75rem] font-bold text-sub">{notice}</p>}
    </div>}
  </div>;
}
