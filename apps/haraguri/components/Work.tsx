'use client';
import { useState } from 'react';
import { Data, Entry, Expense, Member, money, today } from '../lib/model';
import { Room, purchaseStates, roomDate, workExpenses } from '../lib/work';
// `locked`: records (확인·대화·사진·지출) already hang off this entry's occurrences, so date and repeat stay fixed.
export function WorkFields({members,date,entry,locked=false}:{members:Member[];date:string;entry?:Entry|null;locked?:boolean}) {
  const [kind,setKind]=useState(entry?.kind || 'task');
  return <>
    <label>제목<input name="title" required maxLength={200} defaultValue={entry?.title} placeholder="어떤 일을 함께 챙길까요?"/></label>
    <div className="form-grid"><label>종류<select name="kind" value={kind} onChange={e=>setKind(e.target.value as Entry['kind'])}><option value="task">할 일</option><option value="event">일정·행사</option><option value="purchase">같이 살까? · 구매</option></select></label><label>날짜<input type="date" name="date" required defaultValue={entry?.date || date} readOnly={locked} aria-describedby={locked?'entry-lock-note':undefined}/></label></div>
    <label>반복<select name="repeat" key={kind} defaultValue={entry?.repeat || 'none'} disabled={locked||kind==='purchase'}><option value="none">반복 안 함</option><option value="monthly">매월 같은 날짜</option><option value="yearly">매년 같은 날짜</option></select></label>
    {locked?<small id="entry-lock-note" className="muted">확인·대화·사진·지출 기록이 있어 날짜와 반복은 바꿀 수 없어요. 제목·종류·담당자·메모는 수정돼요.</small>:<small className="muted">날짜가 없는 달은 말일로 표시해요. 반복 일정의 대화와 지출은 회차별로 구분돼요.</small>}
    <label>예상 금액 (원 · 선택)<input name="expected_amount" type="number" min="0" max="1000000000" step="1" defaultValue={entry?.expected_amount || 0}/><small className="muted">계획용 금액이에요. 실제 지출은 결제한 뒤 따로 연결합니다.</small></label>
    <label>담당자<select name="assignee" defaultValue={entry?.assignee || ''}><option value="">가족 모두</option>{members.map(m=><option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label>
    <label>메모·상품 링크<textarea name="body" maxLength={5000} rows={3} defaultValue={entry?.body} placeholder="필요한 이유, 상품 링크, 함께 알아둘 내용을 적어주세요."/></label>
  </>;
}
export function ExpenseWorkFields({entries,expense,room}:{entries:Entry[];expense:Expense|null;room:Room}) {
  const [id,setId]=useState(expense?.entry_id || room?.entry.id || '');
  const entry=entries.find(e=>e.id===id);
  return <fieldset className="work-link-fields"><legend>우리집 일 연결</legend><label>관련 일정·구매<select name="entry_id" value={id} onChange={e=>setId(e.target.value)}><option value="">연결 안 함</option>{entries.map(e=><option key={e.id} value={e.id}>{e.title} · {e.date}</option>)}</select></label>{entry&&<label>연결할 회차 날짜<input name="occurrence" type="date" required key={id} readOnly={entry.repeat==='none'} defaultValue={expense?.entry_id===id?expense.occurrence || entry.date:room?.entry.id===id?room.date:roomDate(entry,today().slice(0,7))}/><small className="muted">거래일과 별개예요. 예: 11월 여행 예약금을 10월에 결제할 수 있어요.</small></label>}</fieldset>;
}
export function WorkBoard({title='우리집 일',data,month,onOpen,onCreate,compact=false,onMore}:{title?:string;compact?:boolean;onMore?:()=>void;data:Data;month:string;onOpen:(entry:Entry,date:string)=>void;onCreate:()=>void}) {
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const entries=data.entries.filter(e=>(filter==='all'||e.kind===filter)&&e.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b)=>b.date.localeCompare(a.date));
  return <section className="panel work-board"><div className="section-head"><h2>{title}</h2><button className="secondary" onClick={onCreate}>＋ 일·구매 만들기</button></div><p className="muted">일정·구매마다 사진, 대화, 관련 지출이 한곳에 모여요.</p>{!compact&&<><input aria-label="우리집 일 검색" value={search} onChange={e=>setSearch(e.target.value)} placeholder="일정이나 구매 이름 찾기"/><div className="payment-tabs">{[['all','전체'],['event','일정'],['task','할 일'],['purchase','구매']].map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div></>}<div className="work-grid">{(compact?entries.slice(0,3):entries).map(entry=>{const date=roomDate(entry,month);const expenses=workExpenses(data.expenses,{entry,date});return <button className="work-card" key={entry.id} onClick={()=>onOpen(entry,date)}><small>{entry.kind==='purchase'?'같이 살까?':entry.kind==='event'?'일정':'할 일'} · {date}</small><strong>{entry.title}</strong><p>{entry.body || '가족과 함께 이야기를 시작해요.'}</p><span>{entry.kind==='purchase'?purchaseStates[entry.purchase_state || 'discussing']:'대화 열기 ↗'}</span><small>예상 {money(entry.expected_amount || 0)} · 실제 {money(expenses.reduce((s,e)=>s+Number(e.amount),0))}</small></button>;})}</div>{compact&&onMore&&<button className="wide-button" onClick={onMore}>전체 {entries.length}개 · 일정·구매별 대화 보기 ↗</button>}{!entries.length&&<div className="empty">함께 챙길 일을 만들어 보세요.</div>}</section>;
}
