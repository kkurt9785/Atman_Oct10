'use client';
import { useEffect, useState } from 'react';
import { Budget, Card, CategoryRule, Envelope, EnvelopeEntry, Expense, Entry, INCOME_CATEGORIES, Member, RecurringExpense, Settlement, incomeTotal, money, total, today, daysInMonth } from '../lib/model';
import { BudgetStatus, budgetStatus } from '../lib/budget';
import { categoryIcon, detectIncreases, detectRecurringCandidates, isFixed } from '../lib/finance';
import { matchRule } from '../lib/cardsms.core';
import { settlement } from '../lib/settle';
const short = (n: number) => Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(Math.abs(n) % 10000 ? 1 : 0)}만` : n.toLocaleString('ko-KR');
const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
const RECENT_DAYS = 3; // feed: only the newest days open by default; older days fold to one line each
import { categories, cardProgress, qualifyingAmount, performanceMonth, shiftMonth } from '../lib/finance';
import { ParsedCardMessage, describe, matchCard, parseCardMessage } from '../lib/cardsms';
import { suggestCards, type CardSuggestion } from '../lib/cardsuggest';
import { sameMerchantTargets, suggestCategories } from '../lib/classify';
import { monthCard } from '../lib/monthcard';
import { MonthCardView } from './MonthCard';
import { Report } from '../lib/report';
import { categoryLabel, matchesPaymentFilter, paymentLabel } from '../lib/payment-display';

const methodLabel: Record<string, string> = { card: '카드', bank_transfer: '계좌이체', cash: '현금', other: '기타' };
const REGRET_TAG = false; // hidden: a novelty tag the family did not need; data stays in place
export type FinanceView = 'list' | 'report' | 'recurring' | 'cards';

// Rows collected from phone messages wait here until a person confirms them.
// One tap registers a card the phone keeps reporting; the matching payments attach at once and later ones by themselves.
export function CardSuggestStrip({ suggestions, busy, onRegisterCard }: { suggestions: CardSuggestion[]; busy: boolean; onRegisterCard?: (s: CardSuggestion) => void }) {
  if (!suggestions.length || !onRegisterCard) return null;
  return <div role="status" className="banner card-suggest">💳 알림에 보인 카드를 등록하면 결제가 자동으로 연결돼요.<span className="banner-actions">{suggestions.map(s => <button key={s.key} type="button" disabled={busy} onClick={() => onRegisterCard(s)}>{s.name} 등록 · {s.expenseIds.length}건</button>)}</span></div>;
}

export function RecurringFields({ cards, initial }: { cards: Card[]; initial?: { title: string; amount: number; day: number } | null }) {
  const [method, setMethod] = useState('bank_transfer');
  return <>
    <label>이름<input name="title" required maxLength={200} defaultValue={initial?.title} placeholder="아파트 관리비 / 아이 학원비"/></label>
    <div className="form-grid"><label>금액 (원)<input name="amount" type="number" required min="1" max="1000000000" step="1" defaultValue={initial?.amount}/></label><label>매월 며칠<input name="day_of_month" type="number" required min="1" max="31" defaultValue={initial?.day ?? 25}/></label></div>
    <div className="form-grid"><label>분류<select name="category" defaultValue="관리비">{categories.map(c => <option key={c}>{c}</option>)}</select></label><label>결제 수단<select name="payment_method" value={method} onChange={e => setMethod(e.target.value)}><option value="bank_transfer">계좌이체</option><option value="card">카드</option><option value="cash">현금</option><option value="other">기타</option></select></label></div>
    {method === 'card' && <label>카드<select name="card_id" required><option value="">카드를 선택하세요</option>{cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <div className="form-grid"><label>시작 월<input name="start_month" type="month" required defaultValue={today().slice(0, 7)}/></label><label>종료 월 (선택)<input name="end_month" type="month"/></label></div>
    <p className="muted">매일 0시 10분에 그날 해당하는 반복 지출을 자동으로 기록해요. 31일 설정은 짧은 달에 말일로 들어가요.</p>
  </>;
}

export function EnvelopeFields() {
  return <>
    <p className="muted">자동차세·명절·보험료처럼 가끔 크게 나가는 돈을 매달 조금씩 모아 두는 봉투예요. 목표와 기한을 정하면 이번 달 넣을 금액을 알려드려요.</p>
    <label>이름<input name="env_name" required maxLength={60} placeholder="자동차세 / 설 명절 / 여름 여행" autoFocus/></label>
    <div className="form-grid"><label>목표 금액 (원)<input name="env_target" type="number" inputMode="numeric" required min="1" step="1" placeholder="600000"/></label><label>기한 (선택)<input name="env_due" type="month"/></label></div>
  </>;
}
export function EnvelopePanel({ envelopes, entries, members, uid, busy, onAdd, onEntry, onDelete }: { envelopes: Envelope[]; entries: EnvelopeEntry[]; members: Member[]; uid: string; busy: boolean; onAdd: () => void; onEntry: (e: Envelope, amount: number) => void; onDelete: (e: Envelope) => void }) {
  const ask = (e: Envelope, sign: 1 | -1) => { const v = window.prompt(sign > 0 ? `'${e.name}'에 넣을 금액 (원)` : `'${e.name}'에서 꺼낼 금액 (원)`, ''); const n = Number((v || '').replace(/[^0-9]/g, '')); if (!n) return; onEntry(e, sign * n); };
  const monthsLeft = (due: string | null) => { if (!due) return 0; const [y, m] = due.slice(0, 7).split('-').map(Number); const t = today(); const [ty, tm] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))]; return Math.max(1, (y - ty) * 12 + (m - tm) + 1); };
  return <section className="panel"><div className="section-head"><h2>적립 봉투</h2><button className="secondary" onClick={onAdd}>＋ 봉투</button></div>
    <p className="muted">가끔 크게 나가는 돈을 매달 나눠 모아요. 누가 얼마 넣었는지도 보여요.</p>
    {envelopes.filter(e => !e.closed_at).map(e => { const rows = entries.filter(x => x.envelope_id === e.id); const balance = rows.reduce((s, x) => s + Number(x.amount), 0); const pct = Math.min(100, Math.round(balance / e.target * 100)); const left = monthsLeft(e.due_month); const monthly = left ? Math.max(0, Math.ceil((e.target - balance) / left)) : 0; const by = members.map(m => ({ name: m.display_name, sum: rows.filter(x => x.created_by === m.user_id).reduce((s, x) => s + Number(x.amount), 0) })).filter(b => b.sum > 0);
      return <div className="envelope" key={e.id}><div className="section-head"><div><strong>{e.name}</strong><small className="muted"> · 목표 {money(e.target)}{e.due_month ? ` · ${e.due_month.slice(0, 7).replace('-', '년 ')}월까지` : ''}</small></div><b>{money(balance)}</b></div>
        <progress value={pct} max={100} aria-label={`${e.name} 적립률`}/>
        <small className="muted">{pct}% 모음{balance >= e.target ? ' · 목표 달성 🎉' : left ? ` · 이번 달 ${money(monthly)}씩 넣으면 기한에 맞아요` : ` · ${money(e.target - balance)} 남음`}{by.length ? ` · ${by.map(b => `${b.name} ${money(b.sum)}`).join(' · ')}` : ''}</small>
        <div className="envelope-actions"><button className="primary small" disabled={busy} onClick={() => ask(e, 1)}>＋ 넣기</button><button className="text-button" disabled={busy} onClick={() => ask(e, -1)}>꺼내기</button>{e.created_by === uid && <button className="text-button danger" disabled={busy} onClick={() => { if (window.confirm(`'${e.name}' 봉투를 삭제할까요? 기록도 함께 지워져요.`)) onDelete(e); }}>삭제</button>}</div></div>; })}
    {!envelopes.filter(e => !e.closed_at).length && <div className="empty">아직 봉투가 없어요. 자동차세·명절 같은 큰 지출부터 하나 만들어 보세요.</div>}
  </section>;
}

export function RecurringPanel({ items, cards, busy, onAdd, onToggle, onDelete, expenses, onAddFrom }: { items: RecurringExpense[]; cards: Card[]; busy: boolean; onAdd: () => void; onToggle: (r: RecurringExpense) => void; onDelete: (r: RecurringExpense) => void; expenses: Expense[]; onAddFrom: (c: { title: string; amount: number; day: number }) => void }) {
  const candidates = detectRecurringCandidates(expenses, items);
  const increases = detectIncreases(expenses, items);
  return <section className="panel"><div className="section-head"><h2>매월 반복 지출</h2><button className="secondary" onClick={onAdd}>＋ 반복 지출</button></div>
    <p className="muted">관리비·학원비·구독처럼 매달 같은 지출을 등록해 두면 날짜에 맞춰 자동으로 기록돼요.</p>
    {increases.map(i => <div className="banner" role="status" key={i.id}>📈 <b>{i.title}</b> 금액이 올랐어요: {money(i.from)} → {money(i.to)} ({i.date}). 반복 금액을 확인해 주세요.</div>)}
    {candidates.length > 0 && <div className="suggest-box"><strong>반복 지출 같아요</strong><small className="muted">같은 곳에 비슷한 금액이 여러 달 나갔어요. 등록하면 자동으로 기록돼요.</small>{candidates.map(c => <div className="suggest-row" key={c.title}><span>{c.title} · 약 {money(c.amount)} · {c.months}개월</span><button className="text-button" disabled={busy} onClick={() => onAddFrom(c)}>등록</button></div>)}</div>}
    {items.map(r => <div className="recurring-row" key={r.id}><div><strong>{r.title}</strong><small>매월 {r.day_of_month}일 · {r.category} · {r.payment_method === 'card' ? cards.find(c => c.id === r.card_id)?.name ?? '카드' : methodLabel[r.payment_method]} · {r.start_month.slice(0, 7)}부터{r.end_month ? ` ${r.end_month.slice(0, 7)}까지` : ''}{!r.active && ' · 일시 중지'}</small></div><div className="review-actions"><b>{money(r.amount)}</b><span><button className="text-button" disabled={busy} onClick={() => onToggle(r)}>{r.active ? '중지' : '재개'}</button><button className="text-button" disabled={busy} onClick={() => onDelete(r)}>삭제</button></span></div></div>)}
    {!items.length && <div className="empty">아직 반복 지출이 없어요.</div>}
  </section>;
}

function Bar({ share, tone }: { share: number; tone?: string }) { return <span className="bar"><i style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} className={tone}/></span>; }
export function ReportPanel({ report, month, setMonth, budget, onEditBudget, expenses, members, cards, settlements, onMarkSettled, onUnsettle, settlementOn = false }: { report: Report; month: string; setMonth: (m: string) => void; budget: BudgetStatus; onEditBudget: () => void; expenses: Expense[]; members: Member[]; cards: Card[]; settlements: Settlement[]; onMarkSettled: (m: string) => void; onUnsettle: (m: string) => void; settlementOn?: boolean }) {
  const r = report;
  const exportCsv = () => { // plain UTF-8 CSV with BOM so Excel opens Korean correctly
    const rows = expenses.filter(e => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
    const nameOf = (id: string) => members.find(m => m.user_id === id)?.display_name ?? '';
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['날짜', '구분', '사용처', '분류', '금액', '결제수단', '카드', '기록자', '정산', '후회', '메모'].map(esc).join(','), ...rows.map(e => [e.date, e.kind === 'transfer' ? '자금 이동' : e.kind === 'income' ? '수입' : '지출', e.title, e.category, e.amount, e.payment_method ?? '', cards.find(c => c.id === e.card_id)?.name ?? '', nameOf(e.created_by), e.scope === 'personal' ? '개인' : '공동', e.regret ? 'Y' : '', e.note ?? ''].map(esc).join(','))];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `haraguri-${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const settle = settlement(expenses, members, month);
  const settled = settlements.find(x => x.month.slice(0, 7) === month);
  const max = r.byCategory[0]?.amount || 1;
  const changeText = r.change == null ? '지난달 기록 없음' : `${r.change >= 0 ? '+' : ''}${Math.round(r.change * 100)}% · 지난달 ${money(r.previous)}`;
  return <>
    <div className="month-nav report-nav"><button className="icon-button" aria-label="이전 달" onClick={()=>setMonth(shiftMonth(month,-1))}>‹</button><label className="month-pick"><span>{month.slice(0,4)}년 {Number(month.slice(5))}월 리포트</span><input aria-label="리포트 월" type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)}/></label><button className="icon-button" aria-label="다음 달" onClick={()=>setMonth(shiftMonth(month,1))}>›</button></div>
    <div className="stats"><section className="stat peach"><span>{month} 총지출</span><strong>{money(r.total)}</strong><small>{changeText}</small></section><section className="stat mint"><span>하루 평균</span><strong>{money(r.perDay)}</strong><small>{r.days}일 기준 · {r.count}건</small></section><section className="stat lavender"><span>수입 · 남는 돈</span><strong>{money(r.income)}</strong><small>{r.income > 0 ? `지출 빼면 ${money(r.income - r.total)}` : '수입 기록 없음'}{r.refunds ? ` · 환불 ${money(Math.abs(r.refunds))}` : ''}</small></section></div>
    <div className="fv-line"><span>고정비 <b>{money(r.fixed)}</b></span><span>변동비 <b>{money(r.variable)}</b></span>{REGRET_TAG && r.regretCount > 0 && <span>😣 후회 소비 <b>{r.regretCount}건 · {money(r.regretTotal)}</b></span>}<button className="text-button" onClick={exportCsv}>CSV 내려받기</button></div>
    <section className="panel"><div className="section-head"><h2>분류별</h2><button className="text-button" onClick={onEditBudget}>{budget.total > 0 ? '예산 조정' : '예산 정하기'}</button></div>
      {budget.total > 0 && <div className={`report-budget ${budget.percent >= 80 ? 'usage-warn' : ''}`}>예산 {money(budget.total)} 중 <b>{budget.percent}%</b> 사용 · {budget.remaining >= 0 ? `남은 ${money(budget.remaining)}` : `${money(-budget.remaining)} 초과`}<progress value={Math.min(100, budget.percent)} max={100} className={budget.percent >= 80 ? 'warn' : ''}/></div>}
      <p className="muted">막대는 이달 금액{budget.byCategory.length ? '(분류 예산이 있으면 예산 대비)' : ''}, 오른쪽은 지난달 대비예요.</p>
      {r.byCategory.map(c => { const diff = c.amount - c.previous; const b = budget.byCategory.find(x => x.name === c.name); return <div className="report-row" key={c.name}><span className="report-label">{c.name}</span><Bar share={b ? c.amount / b.budget : c.amount / max} tone={b && c.amount > b.budget ? 'over' : undefined}/><b>{money(c.amount)}{b && <small className="muted"> / {money(b.budget)}</small>}</b><small className={!c.previous ? 'muted' : diff > 0 ? 'delta-up' : diff < 0 ? 'delta-down' : 'muted'}>{b ? `${Math.round(c.amount / b.budget * 100)}% 예산` : `${Math.round(c.share * 100)}%`} · {c.previous ? `${diff >= 0 ? '+' : ''}${money(diff)}` : '신규'}</small></div>; })}
      {!r.byCategory.length && <div className="empty">이달 기록이 아직 없어요.</div>}</section>
    <div className="home-grid">
      <section className="panel"><h2>결제 수단</h2>{r.byMethod.map(m => <div className="report-row" key={m.name}><span className="report-label">{m.name}</span><Bar share={r.total > 0 ? m.amount / r.total : 0} tone="mint"/><b>{money(m.amount)}</b></div>)}{!r.byMethod.length && <div className="empty">—</div>}</section>
      <section className="panel"><h2>누가 썼나</h2>{r.byMember.map(m => <div className="report-row" key={m.user_id}><span className="report-label">{m.name}</span><Bar share={r.total > 0 ? m.amount / r.total : 0} tone="lavender"/><b>{money(m.amount)}</b></div>)}{!r.byMember.length && <div className="empty">—</div>}</section>
    </div>
    {settlementOn && members.length > 1 && <section className="panel settle"><div className="section-head"><h2>월말 정산</h2>{settled ? <button className="text-button" onClick={() => onUnsettle(month)}>정산 취소</button> : <button className="secondary" onClick={() => onMarkSettled(month)}>정산 완료로 표시</button>}</div>
      <p className="muted">공동 지출 {money(settle.shared)}을 {members.length}명이 똑같이 나누면 1인 {money(settle.share)}. ‘개인’으로 표시한 지출은 빠져요.</p>
      {settle.paid.map(p => <div className="report-row three" key={p.user_id}><span className="report-label">{p.name}</span><span className="muted">{money(p.paid)} 냄</span><b className={p.balance >= 0 ? 'income' : ''}>{p.balance >= 0 ? `+${money(p.balance)}` : money(p.balance)}</b></div>)}
      {settle.transfers.length ? settle.transfers.map((t, i) => <p className="settle-line" key={i}><b>{t.from}</b> → <b>{t.to}</b> {money(t.amount)}</p>) : <p className="settle-line">주고받을 돈이 없어요 👌</p>}
      {settled && <small className="muted">{settled.settled_at.slice(0, 10)} 정산 완료로 표시됨</small>}
    </section>}
    <section className="panel"><h2>자주 쓴 곳 TOP 5</h2>{r.topMerchants.map((m, i) => <div className="expense-row" key={m.title}><span className="expense-icon">{i + 1}</span><div><strong>{m.title}</strong><small>{m.count}회</small></div><b>{money(m.amount)}</b></div>)}{!r.topMerchants.length && <div className="empty">—</div>}</section>
  </>;
}

// Paste (or share) a card approval message and the expense form fills itself; the user only confirms.
export function SmsPaste({cards,initial='',onParsed}:{cards:Card[];initial?:string;onParsed:(prefill:Partial<Expense>,parsed:ParsedCardMessage)=>void}) {
  const [text,setText]=useState(initial);
  const [status,setStatus]=useState<ParsedCardMessage|null|undefined>(undefined);
  const [open,setOpen]=useState(!!initial);
  function apply(value:string) {
    setText(value);
    const parsed=parseCardMessage(value);
    setStatus(value.trim()?parsed:undefined);
    if(parsed){const cardId=matchCard(parsed,cards);onParsed({title:parsed.merchant,amount:parsed.amount,date:parsed.date,category:parsed.category,card_id:cardId,payment_method:cardId?'card':'other'},parsed);}
  }
  useEffect(()=>{if(initial)apply(initial);},[initial]); // eslint-disable-line react-hooks/exhaustive-deps
  if(!open) return <button type="button" className="text-button sms-toggle" onClick={()=>setOpen(true)}>✉ 카드 승인 문자 붙여넣어 채우기</button>;
  return <div className="sms-paste">
    <label>카드 승인 문자<textarea name="sms_text" rows={3} value={text} onChange={e=>apply(e.target.value)} placeholder="[Web발신] KB국민카드 1234승인 48,300원 10/27 11:21 동네마트 … 를 그대로 붙여넣으세요"/></label>
    {status===null&&<p className="muted" role="status">금액을 찾지 못했어요. 문자 전체를 붙여넣어 주세요.</p>}
    {status&&<p className="sms-summary" role="status">✓ {describe(status)} → 아래에 채웠어요. 맞는지 확인하고 저장하세요.{status.issuer&&!matchCard(status,cards)&&' 카드는 직접 골라 주세요.'}</p>}
  </div>;
}

export function CardFields({ card, members }: { card?: Card | null; members: Member[] }) {
  const [cardType,setCardType]=useState(card?.card_type || 'credit');
  return <>
    <label>카드 종류<select name="card_type" value={cardType} onChange={e=>setCardType(e.target.value as 'credit'|'debit')}><option value="credit">신용카드</option><option value="debit">체크카드</option></select></label>
    <label>카드 별칭<input name="name" required maxLength={80} defaultValue={card?.name} placeholder="내 생활비 카드"/></label>
    <div className="form-grid"><label>사용자<select name="owner_user_id" defaultValue={card?.owner_user_id || ''}><option value="">가족 공용</option>{members.map(m=><option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label><label>명의자·메모<input name="holder" maxLength={40} defaultValue={card?.holder} placeholder="이름 또는 카드 끝 4자리"/></label></div>
    <label>혜택 실적 구간 (원)<input name="performance_thresholds" defaultValue={card?.performance_thresholds?.join(', ')} placeholder="300000, 500000"/><small className="muted">쉼표로 구분 · 최대 5구간 · 목표가 없으면 비워두세요.</small></label>
    <label>혜택 적용 기준<select name="benefit_basis" defaultValue={card?.benefit_basis || 'previous_month'}><option value="previous_month">전월 실적 → 다음 달 혜택</option><option value="current_month">당월 실적 → 같은 달 혜택</option></select></label>
    <fieldset className="exclusions"><legend>실적에서 제외할 분류</legend><div>{categories.map(c=><label key={c}><input type="checkbox" name="excluded_categories" value={c} defaultChecked={card?.excluded_categories?.includes(c)}/>{c}</label>)}</div><small className="muted">자동 계산 거래에 적용돼요. 변경하면 기존 기록도 다시 계산합니다.</small></fieldset>
    <fieldset className="override-box"><legend>카드사 실적 보정 (월 1회)</legend><p className="muted">카드앱에 보이는 “이번 달 실적” 숫자를 적어 두면 그날까지는 카드사 숫자를 쓰고, 이후 기록만 더해요.</p><div className="form-grid three"><label>기준 월<input name="perf_override_month" type="month" defaultValue={card?.perf_override_month?.slice(0,7) || ''}/></label><label>카드사 실적 (원)<input name="perf_override_amount" type="number" inputMode="numeric" min="0" step="1" defaultValue={card?.perf_override_amount ?? ''}/></label><label>기준 날짜<input name="perf_override_date" type="date" defaultValue={card?.perf_override_date || ''}/></label></div></fieldset>
    <label>혜택·제외 조건 메모<textarea name="benefit_note" maxLength={2000} rows={2} defaultValue={card?.benefit_note} placeholder="30만원 이상 통신 할인 / 할인받은 결제는 실적 제외 등"/></label>
    <div className="form-grid"><label>월 사용 예산 (원)<input name="budget" type="number" min="0" max="1000000000" step="1" defaultValue={card?.budget || 0} required/></label>{cardType==='credit' && <label>카드 한도 (원 · 직접 등록)<input name="credit_limit" type="number" min="0" max="1000000000" step="1" defaultValue={card?.credit_limit || 0} required/></label>}</div>
    <p className="muted">예산과 실적 목표는 별개예요. 카드번호 전체·CVC는 입력하지 마세요.</p>
  </>;
}
export function BudgetFields({ budget, month }: { budget: Budget | null; month: string }) {
  return <>
    <p className="muted">{month.slice(0,4)}년 {Number(month.slice(5))}월부터 적용돼요. 다음에 바꾸기 전까지 같은 예산이 매달 이어집니다. 0이면 예산 없음.</p>
    <label>이번 달 총 예산 (원)<input name="budget_total" type="number" inputMode="numeric" min="0" step="1" defaultValue={budget?.total || ''} placeholder="예: 1500000" autoFocus/></label>
    <fieldset className="budget-grid"><legend>분류별 예산 (선택)</legend>{categories.map(c=><label key={c}>{c}<input name={`budget_${c}`} type="number" inputMode="numeric" min="0" step="1" defaultValue={budget?.by_category?.[c] || ''} placeholder="0"/></label>)}</fieldset>
  </>;
}
export function ExpenseFields({ expense, cards, remembered, openAdvanced=false, extra, rules=[], settlement=false }: { expense?: Partial<Expense> | null; cards: Card[]; remembered?: { payment_method?: string; card_id?: string } | null; openAdvanced?: boolean; extra?: React.ReactNode; rules?: CategoryRule[]; settlement?: boolean }) {
  const [touched,setTouched]=useState(!!expense?.category); // once the person picks a category, learned rules stop overriding it
  const [scope,setScope]=useState<'shared'|'personal'>(expense?.scope || 'shared');
  // New entries start from what was used last time; only amount · merchant · category are asked up front.
  const rememberedCard = remembered?.card_id && cards.some(c => c.id === remembered.card_id) ? remembered.card_id : '';
  const [method,setMethod]=useState<string>(expense?.payment_method || (expense?.card_id?'card':expense?'other':remembered?.payment_method||(cards.length?'card':'bank_transfer')));
  const [cardId,setCardId]=useState(expense?.card_id || (expense ? '' : rememberedCard || (cards.length===1 ? cards[0].id : '')));
  const [category,setCategory]=useState(expense?.category || '식비');
  const [kind,setKind]=useState<'expense'|'income'|'transfer'>(expense?.kind || 'expense');
  const cats=kind==='transfer'?['자금 이동','투자']:kind==='income'?INCOME_CATEGORIES:categories;
  const switchKind=(k:'expense'|'income'|'transfer')=>{ setKind(k); setCategory(k==='transfer'?'자금 이동':k==='income'?INCOME_CATEGORIES[0]:'식비'); if(k==='transfer'||(k==='income'&&method==='card')) setMethod('bank_transfer'); if(k==='expense'&&cards.length&&!expense) setMethod(remembered?.payment_method||'card'); };
  const [more,setMore]=useState(!!expense || openAdvanced || (method==='card' && !cardId));
  const card=method==='card'?cards.find(c=>c.id===cardId):undefined;
  const dateDefault=expense?.date || today();
  const methodText=method==='card'?(card?.name ?? '카드 미선택'):method==='bank_transfer'?'계좌이체':method==='cash'?'현금':'기타';
  return <>
    <div className="payment-tabs kind-tabs" role="group" aria-label="종류"><button type="button" aria-pressed={kind==='expense'} onClick={()=>switchKind('expense')}>지출</button><button type="button" aria-pressed={kind==='income'} onClick={()=>switchKind('income')}>수입</button><button type="button" aria-pressed={kind==='transfer'} onClick={()=>switchKind('transfer')}>자금 이동</button></div><input type="hidden" name="kind" value={kind}/>
    <div className="form-grid amount-first"><label>금액 (원)<input name="amount" type="number" inputMode="numeric" required step="1" min="-1000000000" max="1000000000" defaultValue={expense?.amount} placeholder={kind==='income'?'받은 금액':'환불은 음수'} autoFocus={!expense}/></label><label>사용처·내용<input name="title" required maxLength={200} defaultValue={expense?.title} placeholder="오늘 어디에 썼나요?" onChange={e=>{ if(touched||kind!=='expense') return; const r=matchRule(e.target.value,rules); if(r){ setCategory(r.category); if(r.scope) setScope(r.scope); } }}/></label></div>
    <div className="chip-field"><span className="chip-label">분류</span><div className="chip-row" role="group" aria-label="분류">{cats.map(c=><button type="button" key={c} aria-pressed={category===c} onClick={()=>{setCategory(c);setTouched(true);}}><i>{categoryIcon[c] ?? '•'}</i> {c}</button>)}</div><input type="hidden" name="category" value={category}/></div>
    <button type="button" className="more-toggle" aria-expanded={more} onClick={()=>setMore(o=>!o)}>{more?'간단히 ▴':'자세히 ▾'}<small>{dateDefault===today()?'오늘':dateDefault} · {methodText}{!more&&' · 날짜·결제수단·연결 바꾸기'}</small></button>
    <div className="more-fields" hidden={!more}>
      <label>날짜<input type="date" name="date" required defaultValue={dateDefault}/></label>
      <label>결제 수단<select name="payment_method" value={method} onChange={e=>setMethod(e.target.value)}>{kind==='expense'&&<option value="card">신용·체크카드</option>}<option value="bank_transfer">계좌이체</option><option value="cash">현금</option><option value="other">기타</option></select></label>
      {method==='bank_transfer' && <p className="muted">월세·학원비 등 실제 지출만 기록하세요. 내 계좌 사이의 이동은 ‘자금 이동’으로 선택하세요. 지출·수입 합계에서 제외됩니다.</p>}
      {method==='card' && kind==='expense' && <label>카드<select name="card_id" value={cardId} onChange={e=>setCardId(e.target.value)}><option value="">카드를 선택하세요</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name} · {c.card_type==='debit'?'체크':'신용'}</option>)}</select></label>}
      {card && <label className="inline-label"><input type="checkbox" name="perf_exclude" defaultChecked={expense?.qualifying_amount===0}/>이 거래는 카드 실적에서 제외{card.excluded_categories?.includes(category)?' (분류 설정으로 이미 제외돼요)':''}</label>}
      <label>메모 (선택)<input name="note" maxLength={200} defaultValue={expense?.note || ''} placeholder="누구랑, 무엇을, 왜"/></label>
      {kind==='expense'&&settlement&&<div className="chip-field"><span className="chip-label">정산</span><div className="payment-tabs" role="group" aria-label="정산 범위"><button type="button" aria-pressed={scope==='shared'} onClick={()=>setScope('shared')}>공동</button><button type="button" aria-pressed={scope==='personal'} onClick={()=>setScope('personal')}>개인</button></div><input type="hidden" name="scope" value={scope}/><small className="muted">월말 정산에 들어갈지 정해요. 개인 지출도 가계부 합계에는 포함돼요.</small></div>}
      {kind==='expense'&&REGRET_TAG&&<label className="inline-label"><input type="checkbox" name="regret" defaultChecked={!!expense?.regret}/>😣 후회한 소비</label>}
      {extra}
    </div>
  </>;
}
export function FinancePanel({entries,onOpenWork,cards,expenses,uid,month,setMonth,onAddCard,onEditCard,onEditExpense,onDeleteExpense,busy,view,setView,report,recurring,onAddRecurring,onToggleRecurring,onDeleteRecurring,onRegisterCard,onClassify,rules:familyRules=[],childName='아이',budgets,onEditBudget,members,envelopes,envelopeEntries,settlements,onAddEnvelope,onEnvelopeEntry,onDeleteEnvelope,onMarkSettled,onUnsettle,onToggleRegret,onOpenChat,onAddRecurringFrom,onCapture,settlementOn=false}: {
  entries:Entry[];onOpenWork:(entry:Entry,date:string)=>void;cards:Card[];expenses:Expense[];uid:string;month:string;setMonth:(m:string)=>void;onAddCard:()=>void;onEditCard:(c:Card)=>void;onEditExpense:(e:Expense)=>void;onDeleteExpense:(e:Expense)=>void;busy:boolean;
  view:FinanceView;setView:(v:FinanceView)=>void;report:Report;recurring:RecurringExpense[];onAddRecurring:()=>void;onToggleRecurring:(r:RecurringExpense)=>void;onDeleteRecurring:(r:RecurringExpense)=>void;onRegisterCard?:(s:CardSuggestion)=>void;onClassify?:(e:Expense,category:string)=>void;rules?:CategoryRule[];childName?:string;
  budgets:Budget[];onEditBudget:()=>void;members:Member[];envelopes:Envelope[];envelopeEntries:EnvelopeEntry[];settlements:Settlement[];
  onAddEnvelope:()=>void;onEnvelopeEntry:(e:Envelope,amount:number)=>void;onDeleteEnvelope:(e:Envelope)=>void;onMarkSettled:(month:string)=>void;onUnsettle:(month:string)=>void;onToggleRegret:(e:Expense)=>void;onOpenChat:(e:Expense)=>void;onAddRecurringFrom:(c:{title:string;amount:number;day:number})=>void;onCapture:()=>void;settlementOn?:boolean;
}) {
  const status=budgetStatus(budgets,expenses,month,today()); // family-level, independent of the list filters
  const [q,setQ]=useState('');
  const [layout,setLayout]=useState<'list'|'calendar'>('list');
  const [dayFilter,setDayFilter]=useState<string|null>(null);
  const [scope,setScope]=useState('all');
  const [methodFilter,setMethodFilter]=useState('all');
  const [cardId,setCardId]=useState('all');
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [showCards,setShowCards]=useState(false);
  const [showChart,setShowChart]=useState(false);
  useEffect(()=>{ if(window.matchMedia('(min-width:1101px)').matches){setShowCards(true);setShowChart(true);} },[]); // wide screens have room for the side column
  const [moreOpen,setMoreOpen]=useState(false);
  const [classify,setClassify]=useState<string|null>(null); // feed row whose category chips are open
  const [allCats,setAllCats]=useState(false);
  const [catFilter,setCatFilter]=useState<string|null>(null); // from a bar on the month card: the feed shows that category only
  const [openDays,setOpenDays]=useState<Record<string,boolean>>({}); // day groups toggled by hand; by default only the newest RECENT_DAYS are open
  const [allDays,setAllDays]=useState(false);
  useEffect(()=>{ setOpenDays({}); setAllDays(false); },[month]);
  // One feed by default. Reports, recurring/envelopes and cards sit behind '더 보기' so the tab reads as "what we spent", not a ledger to keep.
  const pill=(v:FinanceView,label:string)=><button type="button" key={v} className={`view-pill ${view===v?'on':''}`} aria-pressed={view===v} onClick={()=>setView(v)}>{label}</button>;
  const tabs=<div className="finance-views" role="group" aria-label="가계부 보기">{pill('list','피드')}{(moreOpen||view!=='list')?<>{pill('report','리포트')}{pill('recurring','반복·적립')}{pill('cards','카드')}</>:<button type="button" className="view-pill more" onClick={()=>setMoreOpen(true)}>더 보기 ▾</button>}</div>;
  // 리포트 = one card of sentences; the former tables (분류별·결제수단·정산·CSV) stay reachable under '자세히'.
  if(view==='report') return <>{tabs}
    <MonthCardView card={monthCard(expenses,members,budgets,month,today(),childName)} month={month} setMonth={setMonth} onEditBudget={onEditBudget} onPickCategory={c=>{setCatFilter(c);setDayFilter(null);setLayout('list');setView('list');}}/>
    <details className="panel fold report-detail"><summary><h2>자세히</h2><small className="muted">분류별 · 결제수단 · 정산 · CSV</small></summary><div className="fold-body"><ReportPanel report={report} month={month} setMonth={setMonth} budget={status} onEditBudget={onEditBudget} expenses={expenses} members={members} cards={cards} settlements={settlements} onMarkSettled={onMarkSettled} onUnsettle={onUnsettle} settlementOn={settlementOn}/></div></details>
  </>;
  if(view==='recurring') return <>{tabs}<RecurringPanel items={recurring} cards={cards} busy={busy} onAdd={onAddRecurring} onToggle={onToggleRecurring} onDelete={onDeleteRecurring} expenses={expenses} onAddFrom={onAddRecurringFrom}/><EnvelopePanel envelopes={envelopes} entries={envelopeEntries} members={members} uid={uid} busy={busy} onAdd={onAddEnvelope} onEntry={onEnvelopeEntry} onDelete={onDeleteEnvelope}/></>;
  const selectableCards=cards.filter(c=>(scope==='all'||c.owner_user_id===uid)&&(methodFilter==='all'||(c.card_type || 'credit')===methodFilter));
  const visibleCards=selectableCards.filter(c=>cardId==='all'||c.id===cardId);
  const visibleExpenses=expenses.filter(e=>e.card_id?visibleCards.some(c=>c.id===e.card_id):cardId==='all'&&(scope==='all'||e.created_by===uid)&&matchesPaymentFilter(e,methodFilter));
  const needle=q.trim().toLocaleLowerCase();
  const rows=visibleExpenses.filter(e=>e.date.startsWith(month)&&(!dayFilter||e.date===dayFilter)&&(!catFilter||e.category===catFilter)&&(!needle||e.title.toLocaleLowerCase().includes(needle)||(e.note||'').toLocaleLowerCase().includes(needle))).sort((a,b)=>b.date.localeCompare(a.date));
  const selectedTotal=total(visibleExpenses,month);
  const daily=Array.from({length:daysInMonth(month)},(_,i)=>({day:i+1,amount:total(visibleExpenses,`${month}-${String(i+1).padStart(2,'0')}`)}));
  const maxDay=Math.max(1,...daily.map(d=>Math.abs(d.amount)));
  // Same-day-of-month comparison with the previous month, so mid-month the number means something.
  const prevMonth=shiftMonth(month,-1);
  const cutDay=month===today().slice(0,7)?today().slice(8):'31';
  const prevToDate=visibleExpenses.filter(e=>e.kind!=='income'&&e.kind!=='transfer'&&e.date.startsWith(prevMonth)&&e.date.slice(8)<=cutDay).reduce((s,e)=>s+e.amount,0);
  const diff=prevToDate>0?Math.round((selectedTotal-prevToDate)/prevToDate*100):null;
  const filterChips:[string,string][]=[['all','전체'],['credit','신용카드'],['debit','체크카드'],['bank_transfer','계좌이체'],['cash','현금'],['other','결제수단 미확인'],['transfer','자금 이동']];
  const activeFilters=[methodFilter!=='all'&&filterChips.find(c=>c[0]===methodFilter)?.[1],scope==='mine'&&'내 카드·내 지출',cardId!=='all'&&cards.find(c=>c.id===cardId)?.name,needle&&`“${q.trim()}”`].filter(Boolean) as string[];
  const groups=rows.reduce<{date:string;rows:Expense[];sum:number;income:number}[]>((acc,e)=>{const g=acc.at(-1);const spend=e.kind==='income'||e.kind==='transfer'?0:e.amount;const inc=e.kind==='income'?e.amount:0;if(g&&g.date===e.date){g.rows.push(e);g.sum+=spend;g.income+=inc;}else acc.push({date:e.date,rows:[e],sum:spend,income:inc});return acc;},[]);
  const monthIncome=incomeTotal(visibleExpenses,month);
  // Scroll stays short: the newest RECENT_DAYS days are open, older days fold to one line (date · N건 · sum) until tapped. A search or a day/category filter opens everything.
  const expandAll=allDays||!!needle||!!dayFilter||!!catFilter;
  const isOpen=(date:string,i:number)=>expandAll||(openDays[date]??i<RECENT_DAYS);
  const collapsed=groups.filter((g,i)=>!isOpen(g.date,i)).length;
  const dayLabel=(d:string)=>{const dt=new Date(`${d}T12:00:00`);return `${dt.getMonth()+1}월 ${dt.getDate()}일 (${'일월화수목금토'[dt.getDay()]})`;};
  const methodName=paymentLabel;
  // '카드' view: register cards the phone has seen, then performance per card and the daily bars. Nothing here is required reading.
  if(view==='cards') return <>{tabs}
    <CardSuggestStrip suggestions={suggestCards(expenses,cards)} busy={busy} onRegisterCard={onRegisterCard}/>
    <details className="panel fold" open={showCards} onToggle={e=>setShowCards(e.currentTarget.open)}><summary><h2>카드별 실적 챙기기</h2><small className="muted">{visibleCards.length?`${visibleCards.length}장${visibleCards.length===1?` · 인정 실적 ${money(cardProgress(visibleCards[0],expenses,month).amount)}`:''}`:'카드 없음'}</small></summary><div className="fold-body">
    <div className="section-head"><p className="muted finance-disclaimer">직접 기록한 내역과 설정한 조건으로 계산해요. 실제 카드사 실적·혜택과 차이가 있을 수 있어요.</p><button className="secondary" onClick={onAddCard}>＋ 카드 추가</button></div>
    <div className="card-grid">{visibleCards.map(card=>{
      const progress=cardProgress(card,expenses,month);
      const basis=card.benefit_basis || 'previous_month';
      const benefitMonth=basis==='previous_month'?shiftMonth(month,1):month;
      const eligibility=cardProgress(card,expenses,basis==='previous_month'?shiftMonth(month,-1):month);
      const spend=total(expenses,month,card.id);
      return <article className="panel performance-card" key={card.id} data-card-id={card.id}>
        <div className="section-head"><div><small className="muted">{card.card_type==='debit'?'체크카드':'신용카드'} · {card.holder || '가족 카드'}{card.owner_user_id===uid?' · 내 카드':''}</small><h2>{card.name}</h2></div><button className="text-button" aria-label={`${card.name} 설정`} onClick={()=>onEditCard(card)}>설정 ↗</button></div>
        <div className="performance-label">{month} 인정 실적 <span>{benefitMonth} 혜택 준비</span></div><strong className="performance-amount">{money(progress.amount)}</strong>{progress.override&&<small className="muted override-note">카드사 기준 {money(progress.override.amount)} ({progress.override.date.slice(5).replace('-','/')}) + 이후 기록</small>}
        {progress.thresholds.length ? <><progress aria-label={`${card.name} 실적 달성률`} value={progress.percent} max={100}/><p className="remaining">{progress.next!=null?<>다음 {money(progress.next)} 구간까지 <b>{money(progress.remaining)} 남았어요</b></>:<b>등록한 실적 구간을 모두 채웠어요 ✓</b>}</p></>:<p className="remaining">실적 목표 미설정 · 설정에서 금액을 등록하세요.</p>}
        <details className="card-more"><summary>자세히 · 구간·혜택 기준·예산</summary>{progress.thresholds.length>0&&<div className="tier-list">{progress.thresholds.map(t=><span className={progress.amount>=t?'achieved':''} key={t}>{money(t)} {progress.amount>=t?'✓':'목표'}</span>)}</div>}
        <div className="eligibility"><small>{month} 혜택 기준 · {basis==='previous_month'?`${shiftMonth(month,-1)} 실적`:'당월 실적'}</small><p>{!progress.thresholds.length?'실적 목표를 먼저 설정해 주세요.':!eligibility.records?'기록 없음 · 카드사 실적 확인 필요':eligibility.achieved.length?`${money(eligibility.achieved.at(-1)!)} 구간 충족 (입력 기록 기준)`:`입력 기록 기준 첫 구간 미달 · ${money(eligibility.amount)}`}</p></div>
        <dl className="card-details"><div><dt>이달 실제 지출</dt><dd>{money(spend)}</dd></div><div><dt>월 예산</dt><dd>{card.budget?`${money(card.budget)} · ${money(Math.abs(card.budget-spend))} ${spend>card.budget?'초과':'남음'}`:'미설정'}</dd></div>{card.card_type!=='debit' && <div><dt>등록 카드 한도</dt><dd>{card.credit_limit?money(card.credit_limit):'미설정'}</dd></div>}</dl>{card.card_type!=='debit' && <small className="muted">한도는 직접 등록한 값이며 실제 이용 가능액은 카드사에서 확인해 주세요.</small>}
        {!!card.excluded_categories?.length && <p className="card-note">실적 제외: {card.excluded_categories.join(' · ')}</p>}{card.benefit_note && <p className="card-note">{card.benefit_note}</p>}</details>
      </article>;
    })}</div>{!visibleCards.length&&<div className="empty">{cards.length?'선택한 범위에 카드가 없어요. 카드 설정에서 사용자를 지정해 주세요.':'쓰는 카드를 등록하면 카드별 지출과 실적이 여기에 보여요. 필수는 아니에요.'}</div>}</div></details>
    <details className="panel fold" open={showChart} onToggle={e=>setShowChart(e.currentTarget.open)}><summary><h2>날짜별 지출</h2><small className="muted">막대 그래프</small></summary><div className="fold-body daily-chart" tabIndex={0} role="region" aria-label="날짜별 지출 그래프"><div className="chart-bars">{daily.map(d=><div key={d.day} title={`${month}-${d.day}: ${money(d.amount)}`}><i style={{height:`${Math.abs(d.amount)/maxDay*85}px`,background:d.amount<0?'#b59d86':undefined}}/><small>{d.day}</small></div>)}</div><small className="muted">일별 순지출 · 갈색 막대는 환불이 더 많은 날이에요.</small></div></details>
  </>;
  return <>
    {tabs}
    <section className="fin-summary" aria-label="이번 달 요약">
      <div className="month-nav"><button className="icon-button" aria-label="이전 달" onClick={()=>setMonth(shiftMonth(month,-1))}>‹</button><label className="month-pick"><span>{month.slice(0,4)}년 {Number(month.slice(5))}월</span><input aria-label="가계부 조회 월" type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label><button className="icon-button" aria-label="다음 달" onClick={()=>setMonth(shiftMonth(month,1))}>›</button></div>
      <div className="fin-figures four">{status.total>0?<button type="button" className={`budget-cell ${status.total>0&&status.percent>=80?'warn':''}`} onClick={onEditBudget} title="예산 설정">{status.total>0?<><span>남은 예산 · {status.percent}% 사용</span><strong>{money(status.remaining)}</strong><small>{status.daysLeft>0?`오늘은 ${money(status.perDay)}까지`:'이번 달 마감'}</small></>:<><span>예산</span><strong className="cta">정하기 →</strong><small>오늘 쓸 수 있는 돈을 알려드려요</small></>}</button>:<div><span>기록된 수입</span><strong className="income">{money(monthIncome)}</strong><small>예산 없이 내역 확인</small></div>}<div><span>이번 달 지출</span><strong>{money(selectedTotal)}</strong>{monthIncome>0&&<small className="income">수입 +{money(monthIncome)}</small>}</div><div><span>오늘</span><strong>{money(total(visibleExpenses,today()))}</strong></div><div><span>지난달 같은 날까지</span><strong className={diff===null?'':diff>0?'up':diff<0?'down':''}>{diff===null?'기록 없음':diff===0?'같아요':`${diff>0?'▲':'▼'} ${Math.abs(diff)}%`}</strong>{prevToDate>0&&<small>{money(prevToDate)}</small>}</div></div>
      {visibleExpenses.some(e=>e.kind==='transfer'&&e.date.startsWith(month))&&<p className="muted">자금 이동 {money(visibleExpenses.filter(e=>e.kind==='transfer'&&e.date.startsWith(month)).reduce((sum,e)=>sum+Number(e.amount),0))} · 지출·수입 합계에서 제외</p>}
      {status.total===0&&<button type="button" className="text-button" aria-label="예산 설정" onClick={onEditBudget}>예산 설정</button>}
      <button className={`filter-toggle ${activeFilters.length?'active':''}`} aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(o=>!o)}>필터{activeFilters.length?` (${activeFilters.length}) · ${activeFilters.join(' · ')}`:''} {filtersOpen?'▴':'▾'}</button>
    </section>
    {filtersOpen&&<div className="fin-filters">
      <div className="payment-tabs" role="group" aria-label="결제 수단 필터">{filterChips.map(([value,label])=><button key={value} aria-pressed={methodFilter===value} onClick={()=>{setMethodFilter(value);setCardId('all');}}>{label}</button>)}</div>
      <div className="finance-toolbar"><label>검색<input aria-label="내역 검색" value={q} onChange={e=>setQ(e.target.value)} placeholder="사용처·메모"/></label><label>사용자 범위<select value={scope} onChange={e=>{setScope(e.target.value);setCardId('all');}}><option value="all">가족 전체</option><option value="mine">내 카드·내 지출</option></select></label><label>카드 선택<select value={cardId} onChange={e=>setCardId(e.target.value)}><option value="all">전체 카드</option>{selectableCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
    </div>}
    <div className="fin-layout"><div className="fin-main">
    <section className="panel ledger"><div className="section-head"><h2>이번 달</h2><div className="payment-tabs mini" role="group" aria-label="내역 보기"><button aria-pressed={layout==='list'} onClick={()=>setLayout('list')}>목록</button><button aria-pressed={layout==='calendar'} onClick={()=>setLayout('calendar')}>달력</button></div><button type="button" className="text-button capture-link" onClick={onCapture} title="카드앱 이용내역 캡처에서 거래 가져오기">📷 캡처 가져오기</button><small className="muted">{rows.length}건</small></div>
      {layout==='calendar'&&<div className="spend-calendar" role="grid" aria-label="날짜별 지출 달력">{weekdayNames.map(w=><div className="weekday" key={w}>{w}</div>)}{Array.from({length:new Date(`${month}-01T12:00:00`).getDay()}).map((_,i)=><div key={`b${i}`}/>)}{daily.map(d=>{const date=`${month}-${String(d.day).padStart(2,'0')}`;return <button type="button" key={d.day} className={`cal-cell ${d.amount?'has':''} ${date===today()?'today':''}`} aria-label={`${date} ${money(d.amount)}`} onClick={()=>{setDayFilter(date);setCatFilter(null);setLayout('list');}}><small>{d.day}</small>{d.amount!==0&&<b>{short(d.amount)}</b>}</button>;})}</div>}
      {dayFilter&&layout==='list'&&<div className="day-chip" role="status"><span>{dayLabel(dayFilter)}만 보는 중</span><button className="text-button" onClick={()=>setDayFilter(null)}>전체 보기</button></div>}
      {catFilter&&layout==='list'&&!dayFilter&&<div className="day-chip" role="status"><span>{catFilter==='기타'?'분류 안 된 것만 보는 중 · 분류 넣기로 정리해요':`${categoryIcon[catFilter]??''} ${catFilter}만 보는 중`}</span><button className="text-button" onClick={()=>setCatFilter(null)}>전체 보기</button></div>}
      {layout==='list'&&groups.map((g,i)=>{const open=isOpen(g.date,i);return <div className="day-group" key={g.date}><button type="button" className={`day-head ${open?'':'closed'}`} aria-expanded={open} onClick={()=>setOpenDays(o=>({...o,[g.date]:!open}))}><span><i className="chev" aria-hidden="true">{open?'▾':'▸'}</i>{dayLabel(g.date)}<small> · {g.rows.length}건</small></span><b>{g.income>0&&<em className="income">+{money(g.income)} · </em>}{money(g.sum)}</b></button>
        {open&&g.rows.map(e=>{const card=cards.find(c=>c.id===e.card_id);const canceled=!!e.canceled_by;const who=members.find(m=>m.user_id===e.created_by);const auto=['push','sms','ocr'].includes(e.source??'');const open=classify===e.id;const isSpend=(e.kind??'expense')==='expense'||e.category==='투자';
          // Feed row: who · when · how, with the amount. Category is a quiet tag (or '분류 넣기' when the parser left 기타) that opens chips in place — no queue, no badges.
          return <div className={`finance-expense feed-row ${canceled?'canceled':''}`} key={e.id}><span className="who" aria-hidden="true">{(who?.display_name||'?').slice(0,1)}</span><div><strong>{e.title}{e.kind==='transfer'&&<span className="room-closed-badge">{e.category==='투자'?'투자 · 집계 제외':'자금 이동 · 집계 제외'}</span>}{e.source==='recurring'&&<span className="room-closed-badge">반복</span>}{canceled&&<span className="room-closed-badge">취소됨</span>}{e.cancels&&<span className="room-closed-badge">취소</span>}{settlementOn&&e.scope==='personal'&&<span className="room-closed-badge">개인</span>}</strong>{e.entry_id&&(()=>{const work=entries.find(w=>w.id===e.entry_id);return work?<button className="text-button linked-work" onClick={()=>onOpenWork(work,e.occurrence || work.date)}>↗ {work.title}</button>:null;})()}<small>{who?.display_name||'가족'}{auto&&e.created_at?` · ${new Date(e.created_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`:''} · {card?.name || methodName(e)}{isSpend&&onClassify?<> · <button type="button" className={`text-button inline cat-tag ${e.category==='기타'?'empty':''}`} aria-expanded={open} onClick={()=>{setClassify(open?null:e.id);setAllCats(false);}}>{e.category==='기타'?'분류 넣기':`${categoryIcon[e.category]??''} ${e.category}`}</button></>:isSpend?` · ${categoryLabel(e)}`:''}{e.note?` · ${e.note}`:''}</small>{open&&onClassify&&<div className="chips cat-chips" role="group" aria-label="분류 고르기">{(allCats?categories:suggestCategories(e,expenses,familyRules)).map(c=><button type="button" key={c} className={`chip ${e.category===c?'on':''}`} disabled={busy} onClick={()=>{setClassify(null);onClassify(e,c);}}>{categoryIcon[c]??''} {c}</button>)}{!allCats&&<button type="button" className="chip more" onClick={()=>setAllCats(true)}>더보기</button>}{(()=>{const n=sameMerchantTargets(e,expenses).length;return n>0?<small className="muted peers">같은 가맹점 {n}건도 같이 바뀌어요</small>:null;})()}</div>}{card&&!!card.performance_thresholds?.length&&<small>{qualifyingAmount(e,card)===0?'실적 제외':`인정 실적 ${money(qualifyingAmount(e,card))}`} · {performanceMonth(e)} 반영</small>}</div><div className="expense-actions">{e.kind==='income'?<b className="income">+{money(e.amount)}</b>:<b>{money(e.amount)}</b>}<span>{e.kind==='expense'&&<button disabled={busy} className="text-button icon-mini" onClick={()=>onOpenChat(e)} aria-label={`${e.title} 대화`} title="이 지출로 대화">💬</button>}{e.created_by===uid&&<><button disabled={busy} className="text-button" onClick={()=>onEditExpense(e)} aria-label={`${e.title} 수정`}>수정</button><button disabled={busy} className="text-button" onClick={()=>onDeleteExpense(e)} aria-label={`${e.title} 삭제`}>삭제</button></>}</span></div></div>;})}
      </div>;})}{layout==='list'&&collapsed>0&&<button type="button" className="text-button fold-days" onClick={()=>setAllDays(true)}>접힌 {collapsed}일 모두 펼치기</button>}{layout==='list'&&allDays&&groups.length>RECENT_DAYS&&<button type="button" className="text-button fold-days" onClick={()=>{setAllDays(false);setOpenDays({});}}>최근 {RECENT_DAYS}일만 펼치기</button>}{layout==='list'&&!rows.length&&<div className="empty">{needle||dayFilter||catFilter?'조건에 맞는 기록이 없어요.':'이번 달 기록이 아직 없어요.'}</div>}</section>
    </div></div>
  </>;
}
