import {describe,it,expect} from 'vitest';
import {normalizeGigSchedule,selectRangeDay,validDate} from '../../../admin-web/lib/staff-schedule';
describe('단기·반복 일정',()=>{
 it('19~21일 단기는 주말을 빼지 않는 연속 근무로 저장한다',()=>{expect(normalizeGigSchedule('range','2026-12-19','2026-12-21',[])).toEqual([1,2,3,4,5,6,7]);});
 it('하루 근무는 해당 날짜 요일만 저장한다',()=>{expect(normalizeGigSchedule('single','2026-12-20','2026-12-20',[])).toEqual([7]);});
 it('반복 요일은 기간 안에 실제 발생해야 한다',()=>{expect(()=>normalizeGigSchedule('repeat','2026-12-19','2026-12-20',[1])).toThrow('해당 요일');expect(normalizeGigSchedule('repeat','2026-12-19','2026-12-21',[1,1,6])).toEqual([1,6]);});
 it('가짜 날짜와 역순 기간을 거절한다',()=>{expect(validDate('2026-02-30')).toBe(false);expect(validDate('2028-02-29')).toBe(true);expect(()=>normalizeGigSchedule('range','2026-12-21','2026-12-19',[])).toThrow();});
 it('종료일 수정으로 전체 범위를 초기화하지 않는다',()=>{expect(selectRangeDay({start:'2026-10-19',end:'2026-10-21'},'end','2026-10-22')).toEqual({start:'2026-10-19',end:'2026-10-22'});});
 it('달력에서 종료일을 먼저 누른 날짜보다 앞에서 골라도 두 날짜를 보존한다',()=>{expect(selectRangeDay({start:'2026-10-21',end:''},'end','2026-10-19')).toEqual({start:'2026-10-19',end:'2026-10-21'});});
 it('시작일 변경 시 유효한 종료일을 유지하며 같은 날도 선택한다',()=>{expect(selectRangeDay({start:'2026-10-19',end:'2026-10-21'},'start','2026-10-20')).toEqual({start:'2026-10-20',end:'2026-10-21'});expect(selectRangeDay({start:'2026-10-19',end:''},'end','2026-10-19').end).toBe('2026-10-19');});
});
