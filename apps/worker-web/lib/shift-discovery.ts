import { distanceKm, type ShiftDisplayLike } from './shift-display';
export type ShiftSort='date'|'distance'|'wage';
type Sortable=ShiftDisplayLike&{id:string;hourly_wage:number};
export function compareShifts(a:Sortable,b:Sortable,sort:ShiftSort){
  const chronological=a.shift_date.localeCompare(b.shift_date)||a.start_time.localeCompare(b.start_time);
  const distance=(item:Sortable)=>{const km=distanceKm(item);return km!==null&&Number.isFinite(km)?km:Number.POSITIVE_INFINITY;};
  if(sort==='distance'){
    const first=distance(a),second=distance(b);
    if(first!==second)return first<second?-1:1;
  }
  if(sort==='wage'&&a.hourly_wage!==b.hourly_wage)return b.hourly_wage-a.hourly_wage;
  return chronological||a.id.localeCompare(b.id);
}
