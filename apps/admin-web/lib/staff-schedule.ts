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

// 요일별 근무시간 — facility_staff.weekday_hours. 키는 ISO 요일('1'=월 … '7'=일), 없는 요일은 기본 출퇴근 시간.
// 토요일 단축·야간진료 요일처럼 하루만 시간이 다른 직원을 위한 값이다. DB record_unified_attendance 가 같은 값으로 출퇴근을 판정한다.
// 휴게시간 선택지(분). 점심이 긴 의원(1시간 30분·2시간)까지 넣었다. 저장된 값이 목록에 없으면 그 값도 고를 수 있게 붙인다.
export const BREAK_MINUTE_OPTIONS=[0,30,60,90,120] as const;
export function breakMinuteOptions(current?:number|null):number[]{
  const list:number[]=[...BREAK_MINUTE_OPTIONS];
  if(typeof current==='number'&&Number.isInteger(current)&&current>=0&&!list.includes(current))list.push(current);
  return list.sort((a,b)=>a-b);
}
export function breakMinutesLabel(minutes:number):string{
  if(minutes<=0)return '없음';
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return hours===0?`${rest}분`:rest===0?`${hours}시간`:`${hours}시간 ${rest}분`;
}

export type WeekdayHours=Record<string,{start:string;end:string}>;
export const WEEKDAY_LABELS=['월','화','수','목','금','토','일'] as const;
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;
export function normalizeWeekdayHours(value:unknown):WeekdayHours{
  const result:WeekdayHours={};
  if(!value||typeof value!=='object'||Array.isArray(value))return result;
  for(const [day,raw] of Object.entries(value as Record<string,unknown>)){
    const start=String((raw as {start?:unknown}|null)?.start??'').slice(0,5);
    const end=String((raw as {end?:unknown}|null)?.end??'').slice(0,5);
    if(/^[1-7]$/.test(day)&&HHMM.test(start)&&HHMM.test(end)&&start<end)result[day]={start,end};
  }
  return result;
}
export function parseWeekdayHours(form:FormData,workWeekdays:number[]):WeekdayHours{
  const result:WeekdayHours={};
  for(let day=1;day<=7;day++){
    const start=String(form.get(`wh_start_${day}`)??'').trim().slice(0,5);
    const end=String(form.get(`wh_end_${day}`)??'').trim().slice(0,5);
    // 비워 두면 기본 시간, 근무요일이 아닌 날에 적힌 시간은 버린다
    if((!start&&!end)||!workWeekdays.includes(day))continue;
    if(!HHMM.test(start)||!HHMM.test(end)||end<=start)throw new Error(`${WEEKDAY_LABELS[day-1]}요일 근무시간을 확인해 주세요. 출근·퇴근을 둘 다 넣고, 퇴근이 출근보다 늦어야 해요.`);
    result[String(day)]={start,end};
  }
  return result;
}
export function staffHoursOn(staff:{defaultStart:string;defaultEnd:string;weekdayHours?:unknown},date:string){
  const day=String(new Date(`${date}T00:00:00Z`).getUTCDay()||7);
  const override=normalizeWeekdayHours(staff.weekdayHours)[day];
  return override?{start:`${override.start}:00`,end:`${override.end}:00`,custom:true}:{start:staff.defaultStart,end:staff.defaultEnd,custom:false};
}
