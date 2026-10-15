'use client';
import { useState } from 'react';
import { selectRangeDay, type ContractRange } from '@/lib/staff-schedule';
const keyOf=(date:Date)=>date.toISOString().slice(0,10);
export function ContractRangePicker({label='계약기간'}:{label?:string}){
  const today=new Date(Date.now()+9*3600000);
  const [month,setMonth]=useState(()=>new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1)));
  const [range,setRange]=useState<ContractRange>({start:'',end:''});
  const [open,setOpen]=useState(false),[edge,setEdge]=useState<'start'|'end'>('start');
  const gridStart=month.getTime()-month.getUTCDay()*86400000;
  const days=Array.from({length:42},(_,i)=>new Date(gridStart+i*86400000));
  function choose(value:string){setRange(current=>selectRangeDay(current,edge,value));if(edge==='start')setEdge('end');}
  function edit(next:'start'|'end'){
    setEdge(next);setOpen(true);const value=range[next]||range.start;
    if(value)setMonth(new Date(value.slice(0,7)+'-01T00:00:00Z'));
  }
  const total=range.start&&range.end?Math.round((Date.parse(range.end)-Date.parse(range.start))/86400000)+1:0;
  return <fieldset className="mt-4 min-w-0">
    <legend className="text-sm font-bold text-sub">{label}</legend>
    <div className="mt-2 grid grid-cols-2 gap-2">
      {(['start','end'] as const).map(part=><label key={part} className="min-w-0 text-xs font-bold text-sub">{part==='start'?'시작일':'종료일'}
        <input aria-label={part==='start'?'근무 시작일':'근무 종료일'} type="date" name={part==='start'?'contract_start':'contract_end'} required value={range[part]}
          onChange={event=>{const value=event.target.value;setRange(current=>({...current,[part]:value}));}}
          className="mt-1 h-12 min-w-0 w-full rounded-xl border border-line bg-white px-2 text-base text-ink"/>
        <button type="button" aria-pressed={open&&edge===part} onClick={()=>edit(part)} className={`mt-1 min-h-11 w-full rounded-xl text-sm font-bold ${open&&edge===part?'bg-primary text-white':'bg-white text-primary'}`}>{part==='start'?'시작일':'종료일'} 달력</button>
      </label>)}
    </div>
    {range.start&&range.end&&range.end<range.start&&<p role="alert" className="mt-2 text-sm text-red-600">종료일은 시작일 이후로 입력해 주세요.</p>}
    {open&&<div className="mt-3 rounded-2xl border border-line bg-white p-2">
      <div className="flex items-center justify-between"><button type="button" aria-label="이전 달" onClick={()=>setMonth(new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()-1,1)))} className="h-11 w-11 text-xl">‹</button><b aria-live="polite" className="text-sm">{month.getUTCFullYear()}년 {month.getUTCMonth()+1}월</b><button type="button" aria-label="다음 달" onClick={()=>setMonth(new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,1)))} className="h-11 w-11 text-xl">›</button></div>
      <p role="status" className="my-2 rounded-xl bg-primary/5 p-2 text-center text-sm font-bold text-primary">{edge==='start'?'시작일':'종료일'}을 선택하세요</p>
      <div className="grid grid-cols-7 text-center text-xs text-sub">{['일','월','화','수','목','금','토'].map(d=><span key={d} className="py-2">{d}</span>)}</div>
      <div className="grid grid-cols-7">{days.map(date=>{const key=keyOf(date),selected=key===range.start||key===range.end,between=range.start&&range.end&&key>range.start&&key<range.end;return <button type="button" key={key} aria-label={key} aria-pressed={selected} onClick={()=>choose(key)} className={`min-h-11 min-w-0 text-sm ${selected?'rounded-lg bg-primary font-bold text-white':between?'bg-primary/10 text-primary':date.getUTCMonth()===month.getUTCMonth()?'text-ink':'text-tertiary'}`}>{date.getUTCDate()}</button>;})}</div>
      <p className="mt-2 text-center text-xs text-sub">{total>0?`${range.start} ~ ${range.end} · ${total}일간`:'시작일을 고른 뒤 종료일을 선택하세요. 같은 날도 가능해요.'}</p>
      <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={()=>{setRange({start:'',end:''});setEdge('start');}} className="min-h-11 rounded-xl bg-bg text-sm font-bold">초기화</button><button type="button" disabled={total<=0} onClick={()=>setOpen(false)} className="min-h-11 rounded-xl bg-ink text-sm font-bold text-white disabled:opacity-40">기간 적용</button></div>
    </div>}
    {!open&&total>0&&<p className="mt-2 text-sm text-sub">{range.start} ~ {range.end} · {total}일간</p>}
  </fieldset>;
}
