import { describe, it, expect } from 'vitest';
import { cardProgress, learnKeyword, parseThresholds, qualifyingAmount, shiftMonth, validateQualifyingAmount } from './finance';

describe('rule keyword learning (2026-11-03 audit)', () => {
  it.each([
    ['롯데쇼핑(주)롯데마트', '롯데쇼핑'], ['우지커피 구로한', '우지커피'], ['바나프레소 영등포문', '바나프레소'], ['경일석유(주)덕', '경일석유'],
    ['삼성드림소아청소년과', '삼성드림소아청소년과'], ['GS25 구로점', 'gs25'], ['CU 편의점', '편의점'],
  ])('learns a merchant word from %s', (title, keyword) => { expect(learnKeyword(title)).toBe(keyword); });
  it.each(['1544-7000', 'MG', 'WON뱅킹 입', '계좌이체', '간편 할인', 'CU'])('refuses to learn a bank, channel or fragment: %s', title => {
    expect(learnKeyword(title)).toBe('');
  });
});
import type { Card, Expense } from './model';
const card:Card={id:'card',family_id:'f',name:'test',holder:'',budget:1000000,credit_limit:3000000,performance_thresholds:[300000,500000],excluded_categories:['세금']};
const expense=(amount:number,extra:Partial<Expense>={}):Expense=>({id:'x',family_id:'f',card_id:'card',title:'test',amount,date:'2026-10-10',category:'식비',created_by:'me',...extra});
describe('card benefit performance',()=>{
 it('keeps exclusion and manual override separate from actual spending',()=>{
  expect(qualifyingAmount(expense(100000,{category:'세금'}),card)).toBe(0);
  expect(qualifyingAmount(expense(100000,{category:'세금',qualifying_amount:50000}),card)).toBe(50000);
  expect(qualifyingAmount(expense(100000,{qualifying_amount:0}),card)).toBe(0);
 });
 it('advances at the exact threshold and completes the highest tier',()=>{
  const p=cardProgress(card,[expense(300000)],'2026-10');
  expect(p.achieved).toEqual([300000]);expect(p.remaining).toBe(200000);expect(p.next).toBe(500000);
  expect(cardProgress(card,[expense(500000)],'2026-10')).toMatchObject({remaining:0,next:null,percent:100});
 });
 it('subtracts refunds in the assigned performance month only',()=>{
  const entries=[expense(320000),expense(-50000,{date:'2026-11-10',performance_month:'2026-10-01'}),expense(999999,{card_id:'other'})];
  expect(cardProgress(card,entries,'2026-10')).toMatchObject({amount:270000,remaining:30000});
  expect(cardProgress(card,entries,'2026-11').records).toBe(0);
 });
 it('handles missing records, no target and negative performance',()=>{
  expect(cardProgress(card,[],'2026-10')).toMatchObject({records:0,amount:0});
  expect(cardProgress({...card,performance_thresholds:[]},[],'2026-10')).toMatchObject({next:null,percent:0});
  expect(cardProgress(card,[expense(-20000)],'2026-10')).toMatchObject({percent:0,remaining:320000});
 });
 it('validates signed manual values and threshold input',()=>{
  expect(()=>validateQualifyingAmount(-100,-50)).not.toThrow();
  expect(()=>validateQualifyingAmount(-100,1)).toThrow();
  expect(()=>validateQualifyingAmount(100,101)).toThrow();
  expect(()=>validateQualifyingAmount(100,-1)).toThrow();
  expect(parseThresholds('500000,300000,300000')).toEqual([300000,500000]);
  expect(parseThresholds('')).toEqual([]);
  for(const invalid of ['0','-1','300000,','1,2,3,4,5,6','text']) expect(()=>parseThresholds(invalid)).toThrow();
 });
 it('uses the correct year at month boundaries',()=>{
  expect(shiftMonth('2026-01',-1)).toBe('2025-12');expect(shiftMonth('2026-12',1)).toBe('2027-01');
 });
});
