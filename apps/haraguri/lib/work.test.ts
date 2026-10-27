import {describe,it,expect} from 'vitest';
import {inRoom,isClosed,looksFinished,roomDate,roomState,workExpenses} from './work';
import {Entry,Expense,RoomState,total} from './model';
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
describe('closed rooms',()=>{
 const closed:RoomState={family_id:'f',entry_id:'work',occurrence:'2026-02-28',closed_at:'2026-03-01T00:00:00Z',closed_by:'u',purged_at:'2026-03-01T00:00:00Z',purged_files:3,purged_bytes:900000};
 const reopened:RoomState={...closed,occurrence:'2026-03-31',closed_at:null,closed_by:null};
 it('closes one occurrence without touching the next one or the general chat',()=>{
  expect(isClosed([closed,reopened],{entry,date:'2026-02-28'})).toBe(true);
  expect(isClosed([closed,reopened],{entry,date:'2026-03-31'})).toBe(false);
  expect(isClosed([closed,reopened],{entry,date:'2026-04-30'})).toBe(false);
  expect(isClosed([closed],null)).toBe(false);
  expect(roomState([closed],{entry,date:'2026-02-28'})?.purged_files).toBe(3);
 });
 it('suggests closing only when this occurrence is done or the purchase reached an end state',()=>{
  const receipts=[{entry_id:'work',occurrence:'2026-02-28',state:'done'},{entry_id:'work',occurrence:'2026-03-31',state:'seen'}];
  expect(looksFinished(entry,'2026-02-28',receipts)).toBe(true);
  expect(looksFinished(entry,'2026-03-31',receipts)).toBe(false);
  const purchase:Entry={...entry,id:'buy',kind:'purchase',repeat:'none',purchase_state:'discussing'};
  expect(looksFinished(purchase,entry.date,[])).toBe(false);
  expect(looksFinished({...purchase,purchase_state:'purchased'},entry.date,[])).toBe(true);
  expect(looksFinished({...purchase,purchase_state:'hold'},entry.date,[])).toBe(true);
 });
});
