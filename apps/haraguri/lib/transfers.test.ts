import {describe,it,expect} from 'vitest';
import {type Expense,type Card,total,incomeTotal} from './model';
import {monthlyReport} from './report';
import {budgetStatus} from './budget';
import {settlement} from './settle';
import {cardProgress,qualifyingAmount,detectRecurringCandidates,detectIncreases} from './finance';

const row=(kind:Expense['kind'],amount:number):Expense=>({id:String(amount),family_id:'f',card_id:null,title:'생활비',date:'2026-11-01',category:'식비',created_by:'me',kind,amount,payment_method:'bank_transfer'});
const rows=[row('expense',38300),row('income',3000000),row('transfer',40000)];
describe('own-account transfers',()=>{
 it('keeps movement out of spending, income, category budgets and settlement',()=>{
  expect(total(rows,'2026-11')).toBe(38300);
  expect(incomeTotal(rows,'2026-11')).toBe(3000000);
  expect(monthlyReport(rows,[{user_id:'me',display_name:'나'}],'2026-11','2026-11-02').total).toBe(38300);
  const b=budgetStatus([{family_id:'f',month:'2026-11-01',total:100000,by_category:{식비:100000}}],rows,'2026-11','2026-11-02');
  expect(b.spent).toBe(38300);expect(b.byCategory[0].spent).toBe(38300);
  expect(settlement(rows,[{user_id:'me',display_name:'나'}],'2026-11').shared).toBe(38300);
 });
 it('does not turn movement into card performance or a recurring expense suggestion',()=>{
  const c:Card={id:'c',family_id:'f',name:'카드',holder:'',budget:0,credit_limit:0};
  const moved={...row('transfer',500000),card_id:'c'};
  expect(qualifyingAmount(moved,c)).toBe(0);
  expect(cardProgress(c,[moved],'2026-11').amount).toBe(0);
  expect(detectRecurringCandidates([row('transfer',500000),{...row('transfer',500000),date:'2026-10-01'}],[])).toEqual([]);
  expect(detectIncreases([moved],[{id:'r',title:'생활비',amount:10000}])).toEqual([]);
 });
});
