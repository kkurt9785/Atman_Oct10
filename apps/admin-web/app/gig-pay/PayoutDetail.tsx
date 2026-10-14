'use client';
import { useId, useState } from 'react';
import { hoursText, periodText, sharePayoutStatement, won, type PayoutStatement } from '@/lib/pay-statement';

// 지급 한 건 — 누르면 '왜 이 금액인지'(시간 × 시급 − 공제)를 펼치고 명세를 공유한다
export function PayoutDetail({ statement, right }: { statement: PayoutStatement; right?: React.ReactNode }) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
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
    </div>
    {right && <div className="mt-2 flex flex-wrap items-center gap-2">{right}</div>}
    {open && <div id={detailId} className="mt-3 rounded-xl bg-bg p-3 text-[0.8125rem] leading-5 text-ink">
      <dl className="divide-y divide-line">
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">계산</dt><dd className="text-right font-bold">{s.payBasis === 'hourly' ? `시급 ${won(s.payRate)} × ${hoursText(s.workedMinutes)}` : s.payBasis === 'daily' ? `일급 ${won(s.payRate)} × ${s.workedDays}일` : `월 정액 ${won(s.payRate)}`}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">세전</dt><dd className="font-bold">{won(s.amount)}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">공제</dt><dd className={`font-bold ${s.withholdingAmount > 0 ? 'text-red-600' : ''}`}>{s.withholdingAmount > 0 ? `사업소득 3.3% −${won(s.withholdingAmount)}` : '없음'}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">실지급</dt><dd className="text-[0.9375rem] font-extrabold text-primary">{won(s.netAmount)}</dd></div>
        <div className="flex justify-between gap-3 py-1.5"><dt className="text-sub">{s.status === 'paid' ? '지급일' : '지급 예정일'}</dt><dd className="font-bold">{(s.status === 'paid' ? (s.paidAt ?? s.payAt ?? '') : (s.payAt ?? '')).slice(0, 10) || '-'}</dd></div>
      </dl>
      <button type="button" onClick={() => void share()} className="mt-3 h-11 w-full rounded-xl border border-primary/30 bg-white text-[0.8125rem] font-extrabold text-primary active:opacity-80">명세 공유 · 복사</button>
      {notice && <p role="status" className="mt-2 text-center text-[0.75rem] font-bold text-sub">{notice}</p>}
    </div>}
  </div>;
}
