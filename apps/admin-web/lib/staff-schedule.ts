export type ContractRange={start:string;end:string};
export function validDate(value:string){
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export function selectRangeDay(range:ContractRange,edge:'start'|'end',value:string):ContractRange{
  if(edge==='start')return{start:value,end:range.end>=value?range.end:''};
  if(!range.start)return{start:value,end:value};
  return value<range.start?{start:value,end:range.start}:{start:range.start,end:value};
}
export function normalizeGigSchedule(mode:string,start:string,end:string,weekdays:number[]){
  if(!['single','range','repeat'].includes(mode)||!validDate(start)||!validDate(end)||end<start)throw new Error('근무 시작일과 종료일을 확인해 주세요.');
  if(mode==='single'&&start!==end)throw new Error('하루 근무는 같은 날짜를 선택해 주세요.');
  const days=mode==='single'?[new Date(start+'T00:00:00Z').getUTCDay()||7]:mode==='range'?[1,2,3,4,5,6,7]:[...new Set(weekdays)].filter(n=>Number.isInteger(n)&&n>=1&&n<=7).sort();
  if(!days.length)throw new Error('반복할 요일을 하나 이상 선택해 주세요.');
  const span=Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
  const first=new Date(start+'T00:00:00Z').getUTCDay();
  if(!Array.from({length:Math.min(span,7)},(_,i)=>(first+i)%7||7).some(day=>days.includes(day)))throw new Error('선택한 기간에 해당 요일이 없어요. 날짜나 요일을 바꿔 주세요.');
  return days;
}
