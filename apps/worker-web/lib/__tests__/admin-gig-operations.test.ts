import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAllRows } from '../../../admin-web/lib/db/read-all-rows';

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, queries: [] as string[] }));
vi.mock('../../../admin-web/lib/facility', () => ({ getCurrentFacilityId: async () => 'site-a' }));
vi.mock('../../../admin-web/lib/date', () => ({ todayKST: () => '2026-10-19' }));
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: () => ({ from: (table: string) => query(table) }) }));

// Execute the real read model against a deterministic read-only query adapter.
function query(table: string) {
  let columns = '', cursor = '', limit = Infinity;
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  const result = () => {
    let rows = [...(state.tables[table] ?? [])].filter(row => filters.every(test => test(row)));
    if (table === 'staff_attendances' && columns === 'id,staff_id,work_date,check_out_at') rows = rows.filter(row => row.status === 'completed');
    rows.sort((a,b) => String(a.id).localeCompare(String(b.id)));
    rows = rows.filter(row => !cursor || String(row.id) > cursor).slice(0, limit);
    return { data: table === 'facility_attendance_settings' ? { late_grace_minutes: 20 } : rows, error: null };
  };
  const builder: any = new Proxy({}, { get: (_, key) => {
    if (key === 'then') return (resolve: (value: unknown) => void) => resolve(result());
    return (...args: any[]) => {
      if (key === 'select') columns = args[0];
      if (key === 'limit') limit = args[0];
      if (key === 'gt' && args[0] === 'id') cursor = args[1];
      if (key === 'eq') { filters.push(row => row[args[0]] === args[1]); if(args[0] === 'facility_id') state.queries.push(`${table}:${args[1]}`); }
      if (key === 'neq') filters.push(row => row[args[0]] !== args[1]);
      if (key === 'in') filters.push(row => args[1].includes(row[args[0]]));
      return builder;
    };
  }});
  return builder;
}

const { getGigOperationsBoard } = await import('../../../admin-web/lib/db/gig-operations');
const { summarizeWork } = await import('../../../admin-web/lib/db/gig-payouts');
const staff = (id: string) => ({ id, facility_id: 'site-a', name: id, worker_id: `worker-${id}`, default_start_time: '22:00', default_end_time: '06:00', status: 'active' });
const attendance = (id: string, staffId: string, status = 'completed') => ({ id, facility_id: 'site-a', staff_id: staffId, work_date: '2026-10-18', status, check_in_at: '2026-10-18T13:00:00Z', check_out_at: status === 'completed' ? '2026-10-18T21:00:00Z' : null });

beforeEach(() => { state.tables = { facility_staff: [staff('night'), staff('owed')], staff_attendances: [attendance('a1','night','working'), attendance('a2','owed')], gig_bank_account_shares: [{ id:'bank', facility_id:'site-a', staff_id:'owed' }] }; state.queries = []; });

describe('관리자 운영 홈의 자정·미지급·대량 데이터', () => {
  it('전날 출근한 야간 근무는 자정 뒤에도 근무 중이다', async () => {
    const board = await getGigOperationsBoard('admin');
    expect(board.workers.find(row => row.staffId === 'night')).toMatchObject({ status:'working', checkInAt:'2026-10-18T13:00:00Z' });
    expect(board.summary.working).toBe(1);
  });
  it('전날 조기퇴근 승인 대기는 검토 대상으로 남는다', async () => {
    state.tables.staff_attendances[0].status = 'checkout_pending';
    expect((await getGigOperationsBoard('admin')).summary.issue).toBe(1);
  });
  it('오늘 근무하지 않아도 미지급 근무는 지급 준비에 포함한다', async () => {
    const board = await getGigOperationsBoard('admin');
    expect(board.workers.find(row => row.staffId === 'owed')).toMatchObject({ status:'pay', unpaidDays:1 });
    expect(board.summary.pay).toBe(1);
  });
  it('근무 중이면서 미지급 근무가 있으면 양쪽 할 일에 포함한다', async () => {
    state.tables.staff_attendances.push(attendance('a3','night'));
    const board = await getGigOperationsBoard('admin');
    expect(board.summary).toMatchObject({ working:1, pay:2 });
  });
  it('1001개 완료근태와 1001개 지급을 누락 없이 읽고 현장 범위를 지킨다', async () => {
    state.tables.staff_attendances = Array.from({length:1001},(_,i) => attendance(`a${String(i).padStart(5,'0')}`,'owed'));
    state.tables.gig_payouts = Array.from({length:1001},(_,i) => ({ id:`p${String(i).padStart(5,'0')}`, facility_id:'site-a', staff_id:'owed', status:'paid', attendance_ids:[`a${String(i).padStart(5,'0')}`] }));
    state.tables.staff_attendances.push({...attendance('other-site','owed'),facility_id:'site-b'});
    expect((await getGigOperationsBoard('admin')).summary.pay).toBe(0);
    expect(state.queries.filter(value => value.startsWith('staff_attendances:')).length).toBeGreaterThan(3);
    expect(state.queries.every(value => value.endsWith(':site-a'))).toBe(true);
  });
  it('지급 계산도 1001개 근태를 모두 계산한다', async () => {
    state.tables.staff_attendances = Array.from({length:1001},(_,i) => attendance(`a${String(i).padStart(5,'0')}`,'owed'));
    const result = await summarizeWork({ from: query } as any, 'site-a', 'owed', '2020-01-01', '2026-10-19');
    expect(result.attendanceIds).toHaveLength(1001);
    expect(result.minutes).toBe(1001 * 480);
  });
});

describe('안전한 커서 페이지 조회', () => {
  it('중간 오류를 부분 성공으로 처리하지 않는다', async () => {
    let count=0;
    const factory=()=>{ const q:any={order:()=>q,limit:()=>q,gt:()=>q,then:(resolve:any)=>resolve(++count===1?{data:[{id:'1'}],error:null}:{data:null,error:{message:'offline'}})};return q; };
    await expect(readAllRows(factory)).rejects.toThrow('전체 운영 데이터');
  });
  it('서버가 커서를 무시하면 무한 반복하지 않는다', async () => {
    const factory=()=>{ const q:any={order:()=>q,limit:()=>q,gt:()=>q,then:(resolve:any)=>resolve({data:[{id:'1'}],error:null})};return q; };
    await expect(readAllRows(factory)).rejects.toThrow('조회 순서');
  });
});
