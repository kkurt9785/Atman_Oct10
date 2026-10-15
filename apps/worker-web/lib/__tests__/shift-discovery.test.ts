import {describe,it,expect} from 'vitest';
import {compareShifts} from '../shift-discovery';
const row=(id:string,date:string,time:string,wage:number,distance:number|null)=>({id,shift_date:date,start_time:time,hourly_wage:wage,distance_km:distance});
const rows=[row('late','2026-10-19','18:00',30000,1),row('early','2026-10-19','09:00',15000,5),row('unknown','2026-10-20','09:00',20000,null)];
describe('근무 탐색 정렬',()=>{
 it('날짜순에서는 높은 금액이 출근시간 순서를 뒤집지 않는다',()=>{expect([...rows].sort((a,b)=>compareShifts(a,b,'date')).map(s=>s.id)).toEqual(['early','late','unknown']);});
 it('가까운 순은 거리를 모르는 공고를 끝에 둔다',()=>{expect([...rows].sort((a,b)=>compareShifts(a,b,'distance')).map(s=>s.id)).toEqual(['late','early','unknown']);});
 it('시급순은 일당이나 날짜와 별도로 시간당 금액을 비교한다',()=>{expect([...rows].sort((a,b)=>compareShifts(a,b,'wage')).map(s=>s.id)).toEqual(['late','unknown','early']);});
});
