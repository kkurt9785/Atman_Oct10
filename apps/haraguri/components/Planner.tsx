'use client';
import { useEffect, useState } from 'react';
import { Data, Entry, daysInMonth, money, monthEntries, today, total } from '../lib/model';
import { shiftMonth } from '../lib/finance';
import { isClosed } from '../lib/work';
import { dayTone, holidayName } from '../lib/holidays';
import { memberColor } from '../lib/colors';

export function Planner({data,month,setMonth,onOpen,onCreate,focusDay}:{data:Data;month:string;setMonth:(m:string)=>void;onOpen:(entry:Entry,date:string)=>void;onCreate:(date:string)=>void;focusDay?:string|null}) {
  const [view,setView]=useState<'year'|'month'|'day'>('month');
  const [selectedDay,setDay]=useState(today());
  const [kind,setKind]=useState('all');
  // The home week strip hands a date over; show that day directly.
  useEffect(()=>{if(focusDay){setDay(focusDay);setMonth(focusDay.slice(0,7));setView('day');}},[focusDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const date=selectedDay.startsWith(month)?selectedDay:`${month}-01`;
  const year=Number(month.slice(0,4));
  const entries=data.entries.filter(e=>kind==='all'||e.kind===kind);
  const rows=monthEntries(entries,month);
  const months=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
  const yearRows=months.flatMap(m=>monthEntries(entries,m));
  const completed=(entry:Entry,date:string)=>data.receipts.some(r=>r.entry_id===entry.id&&r.occurrence===date&&r.state==='done');
  const rowsForDay=(day:string)=>monthEntries(entries,day.slice(0,7)).filter(r=>r.date===day);
  function openDay(day:string){setDay(day);setMonth(day.slice(0,7));setView('day');}
  function move(direction:number){if(view==='year')setMonth(`${year+direction}-${month.slice(5)}`);else if(view==='month')setMonth(shiftMonth(month,direction));else{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+direction);openDay(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);}}
  const period=view==='year'?String(year):view==='day'?date:month;
  const shownRows=view==='year'?yearRows:view==='day'?rows.filter(r=>r.date===date):rows;
  const expenses=data.expenses.filter(e=>e.date.startsWith(period)&&(kind==='all'||entries.some(w=>w.id===e.entry_id)));
  const assigneeName=(entry:Entry)=>entry.assignee?data.members.find(m=>m.user_id===entry.assignee)?.display_name || '가족':'함께';
  const renderRow=({entry,date}:{entry:Entry;date:string})=>{const color=memberColor(data.members,entry.assignee);return <button className="entry" key={`${entry.id}-${date}`} onClick={()=>onOpen(entry,date)}><span className={`entry-icon ${completed(entry,date)?'complete':entry.kind}`}>{completed(entry,date)?'✓':entry.kind==='purchase'?'🛒':entry.kind==='task'?'□':'◷'}</span><span className="entry-copy"><strong>{entry.title}</strong><small>{date} · <i className="member-dot" style={{background:color.fg}}/>{assigneeName(entry)} · {entry.kind==='purchase'?'구매 계획':entry.kind==='event'?'일정':'할 일'}</small></span><span className="entry-end">{isClosed(data.rooms,{entry,date})?'종료':completed(entry,date)?'완료':'대화 ›'}</span></button>;};
  const dayHoliday=holidayName(date);
  return <>
    <section className="panel planner">
      <div className="planner-toolbar"><div className="payment-tabs" role="group" aria-label="일정 보기"><button aria-pressed={view==='year'} onClick={()=>setView('year')}>연간</button><button aria-pressed={view==='month'} onClick={()=>setView('month')}>월간</button><button aria-pressed={view==='day'} onClick={()=>setView('day')}>일간</button></div><button className="secondary" onClick={()=>{setMonth(today().slice(0,7));setDay(today());}}>오늘로</button></div>
      <div className="planner-navigation"><button className="icon-button" aria-label="이전 기간" onClick={()=>move(-1)}>‹</button>{view==='year'?<strong>{year}년 · 우리 가족의 한 해</strong>:view==='month'?<label className="inline-label">조회 월<input type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label>:<label className="inline-label">조회 일<input type="date" value={date} onChange={e=>{if(e.target.value)openDay(e.target.value);}}/></label>}<button className="icon-button" aria-label="다음 기간" onClick={()=>move(1)}>›</button></div>
      <div className="planner-legend"><label>일정 분류<select aria-label="일정 분류" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">전체</option><option value="event">일정·행사</option><option value="task">할 일</option><option value="purchase">구매 계획</option></select></label><span><i className="event"/>일정</span><span><i className="task"/>할 일</span><span><i className="purchase"/>구매</span><span>✓ 완료 · ₩ 지출 · <em className="holiday-dot">●</em> 공휴일</span></div>
      {view==='year'&&<><p className="muted">1년의 계획과 완료 기록을 함께 보세요. 월 이름은 월간 보기, 날짜는 일간 보기로 이어져요. 작은 화면에서는 좌우로 밀어볼 수 있어요.</p><div className="year-scroll"><div className="year-grid"><span className="year-label">월 / 일</span>{Array.from({length:31},(_,i)=><span className="year-number" key={`day-${i}`}>{i+1}</span>)}{months.map(m=><div className="year-row" key={m}><button className="year-label" onClick={()=>{setMonth(m);setView('month');}}>{Number(m.slice(5))}월</button>{Array.from({length:31},(_,i)=>{const d=`${m}-${String(i+1).padStart(2,'0')}`;if(i>=daysInMonth(m))return <span className="year-void" key={d}/>;const items=rowsForDay(d);const allDone=items.length>0&&items.every(r=>completed(r.entry,d));const spent=data.expenses.some(e=>e.kind!=='income'&&e.kind!=='transfer'&&e.date===d);const tone=dayTone(d);return <button key={d} className={`year-cell ${tone} ${d===today()?'today':''} ${allDone?'done':''}`} aria-label={`${d}${holidayName(d)?` ${holidayName(d)}`:''} 일정 ${items.length}개${allDone?' 완료':''}${spent?' 지출 있음':''}`} title={[holidayName(d),...items.map(r=>r.entry.title)].filter(Boolean).join(' / ') || d} onClick={()=>openDay(d)}><span>{allDone?'✓':items.length || ''}</span><span className="year-dots">{[...new Set(items.map(r=>r.entry.kind))].map(k=><i key={k} className={k}/>)}{spent&&<small>₩</small>}</span></button>;})}</div>)}</div></div></>}
      {view==='month'&&<div className="calendar-grid">{['일','월','화','수','목','금','토'].map((d,i)=><span className={`weekday ${i===0?'sun':i===6?'sat':''}`} key={d}>{d}</span>)}{Array.from({length:new Date(`${month}-01T12:00:00`).getDay()},(_,i)=><span key={`blank-${i}`}/>)}{Array.from({length:daysInMonth(month)},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`;const list=rows.filter(r=>r.date===day);const tone=dayTone(day);const holiday=holidayName(day);return <button key={day} className={`calendar-day ${tone} ${day===today()?'today':''} ${day===selectedDay?'chosen':''}`} aria-description={`${day}${holiday?` ${holiday}`:''} 일정 ${list.length}개`} onClick={()=>openDay(day)}><span className="day-number">{i+1}</span>{holiday&&<small className="holiday-name">{holiday}</small>}<span className="year-dots">{[...new Set(list.map(r=>r.entry.kind))].map(k=><i key={k} className={k}/>)}</span><span className="day-titles">{list.slice(0,2).map(r=><em key={`${r.entry.id}-${r.date}`} className={`${r.entry.kind} ${completed(r.entry,r.date)?'done':''}`}>{r.entry.title}</em>)}{list.length>2&&<em className="more">+{list.length-2}</em>}</span>{list.length>0&&<small className="day-count">{list.length}개{list.every(r=>completed(r.entry,day))?' ✓':''}</small>}</button>;})}</div>}
      <div className="planner-summary"><span>계획 <b>{shownRows.length}건</b></span><span>완료 <b>{shownRows.filter(r=>completed(r.entry,r.date)).length}건</b></span><span>실제 지출 <b>{money(total(expenses,period))}</b></span></div>
      <div className="section-head"><h2>{view==='year'?'한 해의 계획':view==='month'?'이번 달 일정·할 일':<>{date} 함께할 일{dayHoliday&&<span className="holiday-chip">{dayHoliday}</span>}</>}</h2><button className="text-button" onClick={()=>onCreate(view==='day'?date:`${month}-01`)}>＋ 이 날짜에 추가</button></div>
      <div className="planner-agenda">{shownRows.map(renderRow)}{!shownRows.length&&<div className="empty">등록된 일정이 없어요. 기대되는 약속부터 남겨보세요.</div>}</div>
    </section>
    {view==='day'&&<section className="panel"><h2>이날의 지출</h2><p className="muted">결제 날짜 기준이에요. 연결된 일은 다른 날짜의 일정일 수도 있어요.</p>{expenses.map(e=>{const entry=data.entries.find(w=>w.id===e.entry_id);return <div className="expense-row" key={e.id}><div><strong>{e.title}</strong><small>{e.category}</small>{entry&&<button className="text-button" onClick={()=>onOpen(entry,e.occurrence || entry.date)}>↗ {entry.title} · 대화 보기</button>}</div><b>{money(e.amount)}</b></div>;})}{!expenses.length&&<div className="empty">이날 기록한 지출이 없어요.</div>}</section>}
  </>;
}
