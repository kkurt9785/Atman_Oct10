'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { createGigPayoutsBulkAction, type BulkPayoutResult } from './actions';
import { withholding } from '@/lib/withholding';
import { addDays, periodChips, untilLabel } from '@/lib/gig-pay-period';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

type Item = { staffId: string; name: string; amount: number };
type Outcome = { at: string; mode: 'now' | 'later'; payAt: string; rows: Array<BulkPayoutResult & { name: string }> };

// 단기근로 점검 기능 6: 정산 기간 끝(기본 오늘) + 버튼 하나로 여러 명 지급 기록 + 퇴근 전 근무 경고.
// 기간은 주소(?until=)로 바꿔 서버가 금액을 다시 계산한다. 기록 결과는 목록이 새로 그려져도 이 칸에 남는다.
export function PayPeriodPanel({ today, until, keep, showBulk, items, excluded, openNames }: {
  today: string; until: string; keep: Record<string, string>; showBulk: boolean;
  items: Item[]; excluded: Array<{ name: string; reason: string }>; openNames: string[];
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<'idle' | 'confirm' | 'later'>('idle');
  const [withhold, setWithhold] = useState(false);
  const [payAt, setPayAt] = useState(addDays(today, 7));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const chips = periodChips(today);
  const custom = !chips.some((chip) => chip.until === until);
  const href = (value: string) => {
    const query = new URLSearchParams({ ...keep, ...(value === today ? {} : { until: value }) }).toString();
    return query ? `/gig-pay?${query}` : '/gig-pay';
  };
  const taxes = items.map((item) => withholding(item.amount, withhold));
  const gross = items.reduce((sum, item) => sum + item.amount, 0);
  const deducted = taxes.reduce((sum, tax) => sum + tax.total, 0);
  const net = taxes.reduce((sum, tax) => sum + tax.net, 0);
  const bulkReady = showBulk && items.length >= 2;

  async function submit(kind: 'now' | 'later') {
    if (busy.current || !bulkReady) return;
    busy.current = true; setPending(true); setError('');
    const names = new Map(items.map((item) => [item.staffId, item.name]));
    const form = new FormData();
    form.set('items', JSON.stringify(items.map((item) => ({ staffId: item.staffId, expectedAmount: item.amount }))));
    form.set('until', until); // 화면에 보이던 기준 그대로 — 자정을 넘겨 눌러도 같은 날짜로 다시 계산한다
    form.set('mode', kind); form.set('pay_at', payAt); form.set('note', note); form.set('withhold', withhold ? '1' : '0');
    try {
      const { results } = await createGigPayoutsBulkAction(form);
      setOutcome({ at: until, mode: kind, payAt, rows: results.map((row) => ({ ...row, name: names.get(row.staffId) ?? '근무자' })) });
      setMode('idle'); setNote('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '기록하지 못했어요. 다시 시도해 주세요.');
    } finally {
      busy.current = false; setPending(false);
    }
  }

  const done = outcome?.rows.filter((row) => row.ok) ?? [];
  const failed = outcome?.rows.filter((row) => !row.ok) ?? [];

  return <section aria-labelledby="pay-period-title" className="mt-4 rounded-2xl bg-white p-4 shadow-card">
    <div className="flex items-baseline justify-between gap-2">
      <h2 id="pay-period-title" className="text-[0.9375rem] font-extrabold text-ink">정산 기간</h2>
      <span className="text-[0.75rem] font-bold text-primary">{untilLabel(until, today)}까지 끝난 근무</span>
    </div>
    <nav aria-label="정산 기간 끝" className="mt-3 flex flex-wrap gap-2">
      {chips.map((chip) => <Link key={chip.until} href={href(chip.until)} aria-current={chip.until === until ? 'page' : undefined}
        className={`inline-flex min-h-11 items-center rounded-xl px-3 text-[0.8125rem] font-bold ${chip.until === until ? 'bg-ink text-white' : 'bg-bg text-sub'}`}>{chip.label}</Link>)}
      {custom && <span aria-current="page" className="inline-flex min-h-11 items-center rounded-xl bg-ink px-3 text-[0.8125rem] font-bold text-white">{untilLabel(until, today)}까지</span>}
    </nav>
    <form action="/gig-pay" method="get" className="mt-2 flex items-end gap-2">
      {Object.entries(keep).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <label className="min-w-0 flex-1 text-[0.6875rem] font-bold text-sub">날짜 직접 고르기
        <input key={until} type="date" name="until" defaultValue={until} min="2020-01-01" max={today} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-[0.8125rem] text-ink" />
      </label>
      <button className="h-11 shrink-0 rounded-xl bg-bg px-4 text-[0.8125rem] font-bold text-ink">적용</button>
    </form>
    <p className="mt-2 text-[0.75rem] leading-5 text-sub">{until < today ? `${untilLabel(until, today)}까지 끝난 근무만 묶어요. 그 뒤 근무는 다음 지급에 그대로 남아요.` : '오늘까지 퇴근·승인이 끝난 근무를 묶어요. 금요일에 지난주분만 주려면 "지난주까지"를 고르세요.'}</p>
    {openNames.length > 0 && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[0.75rem] font-bold leading-5 text-amber-800">
      아직 퇴근 전인 근무가 있어요 · {openNames.slice(0, 3).join(', ')}{openNames.length > 3 ? ` 외 ${openNames.length - 3}명` : ''}. 그 근무는 이번 지급에 들어가지 않아요.
    </p>}

    {bulkReady && <div className="mt-4 border-t border-line pt-4" aria-busy={pending}>
      <h3 className="text-[0.875rem] font-extrabold text-ink">한 번에 지급 기록 · {items.length}명</h3>
      <fieldset disabled={pending} className="min-w-0">
        <ul className="mt-2 divide-y divide-line rounded-xl bg-bg px-3 text-[0.75rem]">
          {items.map((item, index) => <li key={item.staffId} className="flex justify-between gap-2 py-2"><span className="truncate text-ink">{item.name}</span><b className="shrink-0 text-ink">{won(taxes[index].net)}</b></li>)}
        </ul>
        {excluded.length > 0 && <details className="mt-2 rounded-xl border border-line px-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[0.75rem] font-bold text-sub">이번에 빠지는 근무자 {excluded.length}명<span aria-hidden>›</span></summary>
          <ul className="pb-2 text-[0.75rem] leading-5 text-sub">{excluded.map((row) => <li key={row.name + row.reason}>{row.name} · {row.reason}</li>)}</ul>
        </details>}
        <label className="mt-3 flex items-center gap-2 text-[0.75rem] font-bold text-ink">
          <input type="checkbox" checked={withhold} onChange={(event) => setWithhold(event.target.checked)} className="h-4 w-4 accent-primary" />
          3.3% 원천징수를 모두 적용
        </label>
        <p className="mt-1 text-[0.6875rem] leading-4 text-sub">모두 프리랜서 계약일 때만 켜세요. 일용 근무자와 섞여 있으면 아래에서 근무자별로 기록하세요.</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div><p className="text-[0.6875rem] text-sub">세전 합계</p><p className="text-[0.8125rem] font-bold text-ink">{won(gross)}</p></div>
          <div><p className="text-[0.6875rem] text-sub">공제</p><p className="text-[0.8125rem] font-bold text-red-600">−{won(deducted)}</p></div>
          <div><p className="text-[0.6875rem] text-sub">실지급 합계</p><p className="text-[0.9375rem] font-extrabold text-primary">{won(net)}</p></div>
        </div>
        <p className="mt-2 text-[0.75rem] leading-5 text-sub">앱에서 송금하지 않아요. 근무자마다 지급 기록이 한 건씩 생기고, 근무자 앱에 알림이 가요.</p>

        {mode === 'idle' && <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode('confirm')} className="min-h-14 rounded-xl bg-primary px-3 py-2 text-[0.8125rem] font-extrabold leading-5 text-white">모두 이체 완료 기록<span className="block">{won(net)}</span></button>
          <button type="button" onClick={() => setMode('later')} className="min-h-14 rounded-xl border border-line bg-white px-3 py-2 text-[0.8125rem] font-extrabold text-ink">모두 나중에 지급</button>
        </div>}
        {mode === 'confirm' && <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="text-[0.8125rem] font-bold leading-5 text-ink">{items.length}명에게 실지급 {won(net)}을 모두 이체했나요?</p>
          <p className="mt-1 text-[0.6875rem] leading-4 text-sub">이체를 마친 뒤에만 기록하세요. 완료 기록은 되돌릴 수 없어요.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('idle')} className="h-11 rounded-xl bg-white text-[0.75rem] font-bold text-sub">아직이에요</button>
            <button type="button" onClick={() => submit('now')} className="h-11 rounded-xl bg-primary text-[0.75rem] font-extrabold text-white">{pending ? '기록 중...' : '네, 모두 기록'}</button>
          </div>
        </div>}
        {mode === 'later' && <div className="mt-2 rounded-xl bg-bg p-3">
          <label className="block text-[0.6875rem] font-bold text-sub">지급 예정일<input type="date" value={payAt} min={today} onChange={(event) => setPayAt(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-[0.8125rem]" /></label>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-[0.6875rem] font-bold">
            {([['내일', 1], ['7일 뒤', 7], ['2주 뒤', 14]] as const).map(([label, days]) => <button key={label} type="button" onClick={() => setPayAt(addDays(today, days))} className="h-11 rounded-lg bg-white text-sub">{label}</button>)}
          </div>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={80} aria-label="일괄 지급 메모 (선택)" placeholder="메모 (선택) · 예: 10월 마지막 주 정산" className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-[0.75rem]" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('idle')} className="h-11 rounded-xl bg-white text-[0.75rem] font-bold text-sub">취소</button>
            <button type="button" onClick={() => submit('later')} className="h-11 rounded-xl bg-ink text-[0.75rem] font-extrabold text-white">{pending ? '기록 중...' : `${items.length}명 지급 예정으로 기록`}</button>
          </div>
        </div>}
      </fieldset>
      {pending && <p role="status" className="mt-2 text-[0.75rem] font-bold text-sub">{items.length}명 지급 기록을 저장 중이에요. 잠시만 기다려 주세요.</p>}
      {error && <p role="alert" className="mt-2 text-[0.75rem] font-bold text-red-600">{error}</p>}
    </div>}

    {outcome && <div className="mt-3 rounded-xl border border-line p-3" aria-live="polite">
      {done.length > 0 && <p role="status" className="text-[0.75rem] font-bold text-emerald-700">
        {done.length}명 {outcome.mode === 'now' ? '이체 완료로' : `${outcome.payAt} 지급 예정으로`} 기록했어요 · 실지급 {won(done.reduce((sum, row) => sum + (row.net ?? 0), 0))}
      </p>}
      {failed.length > 0 && <div role="alert" className="mt-1 text-[0.75rem] leading-5 text-red-600">
        <p className="font-bold">{failed.length}명은 기록하지 못했어요. 근무자별 칸에서 다시 확인해 주세요.</p>
        <ul>{failed.map((row) => <li key={row.staffId}>{row.name} · {row.error}</li>)}</ul>
      </div>}
    </div>}
  </section>;
}
