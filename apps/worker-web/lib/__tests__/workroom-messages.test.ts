import { describe, expect, it, vi } from 'vitest';
import { loadWorkroomPage, type WorkroomMessage } from '../workroom-messages';
import type { SupabaseClient } from '@supabase/supabase-js';
function fixture(results:unknown[]) {
  const queries:any[]=[];
  const from=vi.fn(()=>{
    const result=results[queries.length];
    const query:any={then:(resolve:any)=>Promise.resolve(result).then(resolve)};
    for(const name of ['select','eq','is','or','order','limit','lt'])query[name]=vi.fn(()=>query);
    queries.push(query);return query;
  });return {client:{from} as unknown as SupabaseClient,queries};
}
const message=(id:string,time:string)=>({id,created_at:time} as WorkroomMessage);
describe('워크룸 대화 페이지',()=>{
  it('최신 대화부터 요청하고 화면에는 시간순으로 표시한다',async()=>{
    const {client,queries}=fixture([{data:[message('b','2026-10-14T02:00:00Z'),message('a','2026-10-14T01:00:00Z')],error:null}]);
    const result=await loadWorkroomPage(client,{facilityId:'facility',staffId:null,includeGroup:false});
    expect(result.messages.map(row=>row.id)).toEqual(['a','b']);
    expect(queries[0].order).toHaveBeenCalledWith('created_at',{ascending:false});
    expect(queries[0].is).toHaveBeenCalledWith('staff_id',null);
  });
  it('같은 시각의 이전 메시지를 불러와도 본인 비공개·전체방 필터를 유지한다',async()=>{
    const {client,queries}=fixture([{data:[message('a','2026-10-13T01:00:00Z')],error:null},{data:[message('b','2026-10-14T01:00:00Z')],error:null}]);
    const result=await loadWorkroomPage(client,{facilityId:'facility',staffId:'staff',includeGroup:true},message('c','2026-10-14T01:00:00Z'));
    expect(result.messages.map(row=>row.id)).toEqual(['a','b']);
    for(const query of queries){expect(query.eq).toHaveBeenCalledWith('facility_id','facility');expect(query.or).toHaveBeenCalledExactlyOnceWith('staff_id.is.null,staff_id.eq.staff');}
    expect(queries[1].lt).toHaveBeenCalledWith('id','c');
  });
  it('조회 실패를 대화 없음으로 취급하지 않는다',async()=>{
    const {client}=fixture([{data:null,error:{message:'offline'}}]);
    await expect(loadWorkroomPage(client,{facilityId:'facility',staffId:'staff',includeGroup:false})).rejects.toThrow('불러오지 못');
  });
});
