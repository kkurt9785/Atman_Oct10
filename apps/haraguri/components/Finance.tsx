'use client';
import { useEffect, useState } from 'react';
import { Card, Expense, Entry, Member, money, total, today, daysInMonth } from '../lib/model';
import { categories, cardProgress, qualifyingAmount, performanceMonth, shiftMonth } from '../lib/finance';
import { ParsedCardMessage, describe, matchCard, parseCardMessage } from '../lib/cardsms';

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
    <label>혜택·제외 조건 메모<textarea name="benefit_note" maxLength={2000} rows={2} defaultValue={card?.benefit_note} placeholder="30만원 이상 통신 할인 / 할인받은 결제는 실적 제외 등"/></label>
    <div className="form-grid"><label>월 사용 예산 (원)<input name="budget" type="number" min="0" max="1000000000" step="1" defaultValue={card?.budget || 0} required/></label>{cardType==='credit' && <label>카드 한도 (원 · 직접 등록)<input name="credit_limit" type="number" min="0" max="1000000000" step="1" defaultValue={card?.credit_limit || 0} required/></label>}</div>
    <p className="muted">예산과 실적 목표는 별개예요. 카드번호 전체·CVC는 입력하지 마세요.</p>
  </>;
}
export function ExpenseFields({ expense, cards }: { expense?: Partial<Expense> | null; cards: Card[] }) {
  const [method,setMethod]=useState<string>(expense?.payment_method || (expense?.card_id?'card':expense?'other':cards.length?'card':'bank_transfer'));
  const [cardId,setCardId]=useState(expense?.card_id || '');
  const [category,setCategory]=useState(expense?.category || '식비');
  const [mode,setMode]=useState(expense?.qualifying_amount == null ? 'auto' : expense.qualifying_amount===0 ? 'exclude' : 'manual');
  const card=method==='card'?cards.find(c=>c.id===cardId):undefined;
  return <>
    <label>사용처·내용<input name="title" required maxLength={200} defaultValue={expense?.title} placeholder="오늘 어디에 썼나요?"/></label>
    <div className="form-grid"><label>날짜<input type="date" name="date" required defaultValue={expense?.date || today()}/></label><label>금액 (원)<input name="amount" type="number" required step="1" min="-1000000000" max="1000000000" defaultValue={expense?.amount} placeholder="환불은 음수"/></label></div>
    <label>결제 수단<select name="payment_method" value={method} onChange={e=>setMethod(e.target.value)}><option value="card">신용·체크카드</option><option value="bank_transfer">계좌이체 (지출)</option><option value="cash">현금</option><option value="other">기타</option></select></label>
    {method==='bank_transfer' && <p className="muted">월세·학원비 등 실제 지출만 기록하세요. 내 계좌 사이의 이동은 제외해 주세요.</p>}
    {method==='card' && <label>카드<select name="card_id" required value={cardId} onChange={e=>setCardId(e.target.value)}><option value="">카드를 선택하세요</option>{cards.map(c=><option key={c.id} value={c.id}>{c.name} · {c.card_type==='debit'?'체크':'신용'}</option>)}</select></label>}
    <label>분류<select name="category" value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
    {card && <><label>실적 반영<select name="qualifying_mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="auto">카드의 제외 분류로 자동 계산</option><option value="exclude">이 거래는 실적 제외</option><option value="manual">인정 금액 직접 입력</option></select></label>
    {mode==='manual' && <label>인정 실적 (원)<input name="qualifying_amount" type="number" step="1" required defaultValue={expense?.qualifying_amount ?? expense?.amount} placeholder="환불 실적도 음수로 입력"/></label>}
    <p className="muted">{mode==='auto' ? card.excluded_categories?.includes(category) ? '이 분류는 실적에서 제외됩니다.' : '결제·환불 금액 전액을 실적에 반영합니다.' : mode==='exclude' ? '지출에는 포함하고 실적에는 반영하지 않습니다.' : '거래 금액 범위 내에서 인정되는 금액만 입력하세요.'}</p>
    <label>실적 반영 월 (선택)<input type="month" name="performance_month" defaultValue={expense?.performance_month?.slice(0,7) || ''}/><small className="muted">비우면 거래한 달에 반영해요. 환불이 원래 결제 월의 실적을 차감하면 그 달을 지정하세요.</small></label></>}
  </>;
}
export function FinancePanel({entries,onOpenWork,cards,expenses,uid,month,setMonth,onAddCard,onEditCard,onEditExpense,onDeleteExpense,busy}: {
  entries:Entry[];onOpenWork:(entry:Entry,date:string)=>void;cards:Card[];expenses:Expense[];uid:string;month:string;setMonth:(m:string)=>void;onAddCard:()=>void;onEditCard:(c:Card)=>void;onEditExpense:(e:Expense)=>void;onDeleteExpense:(e:Expense)=>void;busy:boolean;
}) {
  const [scope,setScope]=useState('all');
  const [methodFilter,setMethodFilter]=useState('all');
  const [cardId,setCardId]=useState('all');
  const selectableCards=cards.filter(c=>(scope==='all'||c.owner_user_id===uid)&&(methodFilter==='all'||(c.card_type || 'credit')===methodFilter));
  const visibleCards=selectableCards.filter(c=>cardId==='all'||c.id===cardId);
  const visibleExpenses=expenses.filter(e=>e.card_id?visibleCards.some(c=>c.id===e.card_id):cardId==='all'&&(scope==='all'||e.created_by===uid)&&(methodFilter==='all'||(e.payment_method || 'other')===methodFilter));
  const rows=visibleExpenses.filter(e=>e.date.startsWith(month)).sort((a,b)=>b.date.localeCompare(a.date));
  const selectedTotal=total(visibleExpenses,month);
  const daily=Array.from({length:daysInMonth(month)},(_,i)=>({day:i+1,amount:total(visibleExpenses,`${month}-${String(i+1).padStart(2,'0')}`)}));
  const maxDay=Math.max(1,...daily.map(d=>Math.abs(d.amount)));
  return <>
    <div className="payment-tabs" role="group" aria-label="결제 수단 필터">{[['all','전체'],['credit','신용카드'],['debit','체크카드'],['bank_transfer','계좌이체'],['cash','현금'],['other','기타']].map(([value,label])=><button key={value} aria-pressed={methodFilter===value} onClick={()=>{setMethodFilter(value);setCardId('all');}}>{label}</button>)}</div>
    <div className="finance-toolbar"><label>조회 월<input aria-label="가계부 조회 월" type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label><label>사용자 범위<select value={scope} onChange={e=>{setScope(e.target.value);setCardId('all');}}><option value="all">가족 전체</option><option value="mine">내 카드·내 지출</option></select></label><label>카드 선택<select value={cardId} onChange={e=>setCardId(e.target.value)}><option value="all">전체 카드</option>{selectableCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
    <div className="stats"><section className="stat peach"><span>{month} 지출</span><strong>{money(selectedTotal)}</strong><small>선택 범위 · 결제에서 환불을 뺀 금액</small></section><section className="stat mint"><span>오늘 지출</span><strong>{money(total(visibleExpenses,today()))}</strong><small>{today()} · 선택 범위 기준</small></section><section className="stat lavender"><span>이번 조회 월 기록</span><strong>{rows.length}<em>건</em></strong><small>카드·현금 직접 입력 기준</small></section></div>
    {['all','credit','debit'].includes(methodFilter) && <><div className="section-head"><h2>카드별 실적 챙기기</h2><button className="secondary" onClick={onAddCard}>＋ 카드 추가</button></div>
    <p className="muted finance-disclaimer">직접 기록한 내역과 설정한 조건으로 계산해요. 실제 카드사 실적·혜택과 차이가 있을 수 있어요.</p>
    <div className="card-grid">{visibleCards.map(card=>{
      const progress=cardProgress(card,expenses,month);
      const basis=card.benefit_basis || 'previous_month';
      const benefitMonth=basis==='previous_month'?shiftMonth(month,1):month;
      const eligibility=cardProgress(card,expenses,basis==='previous_month'?shiftMonth(month,-1):month);
      const spend=total(expenses,month,card.id);
      return <article className="panel performance-card" key={card.id} data-card-id={card.id}>
        <div className="section-head"><div><small className="muted">{card.card_type==='debit'?'체크카드':'신용카드'} · {card.holder || '가족 카드'}{card.owner_user_id===uid?' · 내 카드':''}</small><h2>{card.name}</h2></div><button className="text-button" aria-label={`${card.name} 설정`} onClick={()=>onEditCard(card)}>설정 ↗</button></div>
        <div className="performance-label">{month} 인정 실적 <span>{benefitMonth} 혜택 준비</span></div><strong className="performance-amount">{money(progress.amount)}</strong>
        {progress.thresholds.length ? <><progress aria-label={`${card.name} 실적 달성률`} value={progress.percent} max={100}/><p className="remaining">{progress.next!=null?<>다음 {money(progress.next)} 구간까지 <b>{money(progress.remaining)} 남았어요</b></>:<b>등록한 실적 구간을 모두 채웠어요 ✓</b>}</p><div className="tier-list">{progress.thresholds.map(t=><span className={progress.amount>=t?'achieved':''} key={t}>{money(t)} {progress.amount>=t?'✓':'목표'}</span>)}</div></>:<p className="remaining">실적 목표 미설정 · 설정에서 금액을 등록하세요.</p>}
        <div className="eligibility"><small>{month} 혜택 기준 · {basis==='previous_month'?`${shiftMonth(month,-1)} 실적`:'당월 실적'}</small><p>{!progress.thresholds.length?'실적 목표를 먼저 설정해 주세요.':!eligibility.records?'기록 없음 · 카드사 실적 확인 필요':eligibility.achieved.length?`${money(eligibility.achieved.at(-1)!)} 구간 충족 (입력 기록 기준)`:`입력 기록 기준 첫 구간 미달 · ${money(eligibility.amount)}`}</p></div>
        <dl className="card-details"><div><dt>이달 실제 지출</dt><dd>{money(spend)}</dd></div><div><dt>월 예산</dt><dd>{card.budget?`${money(card.budget)} · ${money(Math.abs(card.budget-spend))} ${spend>card.budget?'초과':'남음'}`:'미설정'}</dd></div>{card.card_type!=='debit' && <div><dt>등록 카드 한도</dt><dd>{card.credit_limit?money(card.credit_limit):'미설정'}</dd></div>}</dl>{card.card_type!=='debit' && <small className="muted">한도는 직접 등록한 값이며 실제 이용 가능액은 카드사에서 확인해 주세요.</small>}
        {!!card.excluded_categories?.length && <p className="card-note">실적 제외: {card.excluded_categories.join(' · ')}</p>}{card.benefit_note && <p className="card-note">{card.benefit_note}</p>}
      </article>;
    })}</div>{!visibleCards.length&&<div className="panel empty">{cards.length?'선택한 범위에 카드가 없어요. 카드 설정에서 사용자를 지정해 주세요.':'쓰는 카드를 등록하고 혜택 실적을 챙겨보세요.'}</div>}</>}
    <section className="panel daily-chart"><h2>날짜별 지출</h2><div className="chart-bars">{daily.map(d=><div key={d.day} title={`${month}-${d.day}: ${money(d.amount)}`}><i style={{height:`${Math.abs(d.amount)/maxDay*85}px`,background:d.amount<0?'#b59d86':undefined}}/><small>{d.day}</small></div>)}</div><small className="muted">일별 순지출 · 갈색 막대는 환불이 더 많은 날이에요.</small></section>
    <section className="panel"><div className="section-head"><h2>지출·환불 내역</h2><small className="muted">{rows.length}건</small></div>{rows.map(e=>{const card=cards.find(c=>c.id===e.card_id);return <div className="finance-expense" key={e.id}><div><strong>{e.title}</strong>{e.entry_id&&(()=>{const work=entries.find(w=>w.id===e.entry_id);return work?<button className="text-button linked-work" onClick={()=>onOpenWork(work,e.occurrence || work.date)}>↗ {work.title}</button>:null;})()}<small>{e.date} · {card?.name || (e.payment_method==='bank_transfer'?'계좌이체':e.payment_method==='cash'?'현금':'기타')} · {e.category}</small>{card&&<small>{qualifyingAmount(e,card)===0?'실적 제외':`인정 실적 ${money(qualifyingAmount(e,card))}`} · {performanceMonth(e)} 반영</small>}</div><div className="expense-actions"><b>{money(e.amount)}</b>{e.created_by===uid&&<span><button disabled={busy} className="text-button" onClick={()=>onEditExpense(e)} aria-label={`${e.title} 수정`}>수정</button><button disabled={busy} className="text-button" onClick={()=>onDeleteExpense(e)} aria-label={`${e.title} 삭제`}>삭제</button></span>}</div></div>;})}{!rows.length&&<div className="empty">이번 달 기록이 아직 없어요.</div>}</section>
  </>;
}
