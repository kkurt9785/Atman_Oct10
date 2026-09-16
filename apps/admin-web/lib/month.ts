// 월(YYYY-MM) 경계 계산. `${month}-31` 같은 리터럴은 2·4·6·9·11월에 존재하지 않는 날짜라
// PostgREST 질의가 통째로 실패한다. 월 범위를 다루는 곳은 반드시 이 헬퍼를 쓴다.
export const isValidMonth=(month:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month);

export function monthStart(month:string){
  if(!isValidMonth(month))throw new Error('조회할 월 형식이 올바르지 않아요.');
  return `${month}-01`;
}

export function monthEnd(month:string){
  if(!isValidMonth(month))throw new Error('조회할 월 형식이 올바르지 않아요.');
  const d=new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth()+1);
  return new Date(d.getTime()-86400000).toISOString().slice(0,10);
}
