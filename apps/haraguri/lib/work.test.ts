import {describe,it,expect} from 'vitest';
import {inRoom,roomDate,workExpenses} from './work';
import {Entry,Expense,total} from './model';
const entry:Entry={id:'work',family_id:'f',title:'관리비',body:'',date:'2026-01-31',kind:'task',repeat:'monthly',assignee:'',created_by:'u'};
describe('shared work and room boundaries',()=>{
 it('keeps general chat and each recurring room separate',()=>{
  const room={entry,date:'2026-02-28'};
  expect(inRoom({entry_id:null,occurrence:null},null)).toBe(true);
  expect(inRoom({entry_id:null,occurrence:null},room)).toBe(false);
  expect(inRoom({entry_id:'work',occurrence:'2026-02-28'},room)).toBe(true);
  expect(inRoom({entry_id:'work',occurrence:'2026-03-31'},room)).toBe(false);
  expect(inRoom({entry_id:'another',occurrence:'2026-02-28'},room)).toBe(false);
 });
 it('links an existing transaction without counting it a second time',()=>{
  const expense:Expense={id:'x',family_id:'f',card_id:null,title:'납부',amount:10000,date:'2026-03-01',category:'관리비',created_by:'u'};
  const linked={...expense,entry_id:'work',occurrence:'2026-02-28'};
  expect(workExpenses([linked],{entry,date:'2026-02-28'})).toEqual([linked]);
  expect(total([linked],'2026-03')).toBe(total([expense],'2026-03'));
  expect(workExpenses([linked],{entry,date:'2026-03-31'})).toEqual([]);
 });
 it('opens the selected recurring occurrence including month-end',()=>{
  expect(roomDate(entry,'2026-02')).toBe('2026-02-28');
  expect(roomDate({...entry,repeat:'none'},'2026-02')).toBe('2026-01-31');
 });
});
