'use client';
import { useState } from 'react';
import { estimateTemporary, TEMPORARY_PEOPLE } from '@/lib/pricing-proposal';
import { won } from '@/lib/format';

export function UsagePricing() {
  const [people, setPeople] = useState(10);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const estimate = estimateTemporary(people, start, end);
  return <section aria-labelledby="usage-pricing-title" className="mb-5 rounded-2xl border border-primary/20 bg-white p-4">
    <p className="text-xs font-bold text-primary">단기·행사 요금 검토안 · 아직 판매하지 않아요</p>
    <h2 id="usage-pricing-title" className="mt-1 text-title font-extrabold">이용 기간과 관리 인원으로 확인하세요</h2>
    <p className="mt-2 text-sm leading-6 text-sub">현재 선택한 현장 한 곳 기준이에요. 시작일·종료일과 중간에 쉬는 날도 기간에 포함돼요.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-bold">시작일<input type="date" value={start} onChange={e => setStart(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-xl border px-3 text-base" /></label>
      <label className="text-sm font-bold">종료일<input type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-xl border px-3 text-base" /></label>
      <label className="text-sm font-bold">기간 내 관리할 인원<select value={people} onChange={e => setPeople(Number(e.target.value))} className="mt-1 h-11 w-full rounded-xl border px-3 text-base">{TEMPORARY_PEOPLE.map(count => <option key={count} value={count}>{count}명까지</option>)}<option value={51}>50명 초과 · 상담</option></select></label>
    </div>
    <div className="mt-4 rounded-xl bg-bg p-4" aria-live="polite" aria-atomic="true">
      {!start || !end ? <p className="text-sm text-sub">기간을 선택하면 검토 중인 예상 금액을 보여드려요.</p> : !estimate ? <p role="alert" className="text-sm text-red-600">날짜를 확인해 주세요. 종료일은 시작일보다 빠를 수 없어요.</p> : <>
        <p className="text-sm text-sub">{estimate.days}일 · {people > 50 ? '50명 초과' : `${people}명까지`} · 검토안</p>
        {estimate.quote ? <><p className="mt-1 text-2xl font-extrabold">{won(estimate.quote.total)} <span className="text-xs font-normal text-sub">부가세 포함</span></p><p className="mt-1 text-xs text-sub">공급가 {won(estimate.quote.net)} + 부가세 {won(estimate.quote.vat)}</p></> : <p className="mt-1 font-bold">별도 견적 · 인원과 기간을 운영팀에 알려 주세요.</p>}
      </>}
    </div>
    <p className="mt-3 text-sm leading-6 text-sub">10명 기준 1일 9,900원, 연속 7일 이내 최대 39,000원(부가세 별도)을 검토 중이에요. 2~3일은 일 단가로 계산해요. 10명 초과·8일 이상은 별도 견적입니다.</p>
    <p className="mt-2 text-xs leading-5 text-sub">같은 사람의 반복 근무는 한 명으로, 초대만 보낸 사람은 제외하는 정책안이에요. 인원 초과 시 사전 확인하며 자동 추가 청구하지 않는 구성입니다.</p>
    <p className="mt-2 text-xs leading-5 text-sub">선택해도 등록 한도·청구액은 바뀌지 않아요. 현재 무료 베타 조건이 계속 적용되며, 병원·약국·요양병원 월 요금은 변경하지 않아요.</p>
  </section>;
}
