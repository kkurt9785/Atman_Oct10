import type { Expense, Member } from './model';

// Month-end settlement of shared spending, split equally among members: who paid more than their share, and the fewest transfers to even out.
export type Settle = { shared: number; share: number; paid: { user_id: string; name: string; paid: number; balance: number }[]; transfers: { from: string; to: string; amount: number }[] };
export function settlement(expenses: Expense[], members: Member[], month: string): Settle {
  const rows = expenses.filter(e => e.date.startsWith(month) && e.kind !== 'income' && (e.scope ?? 'shared') === 'shared');
  const shared = rows.reduce((s, e) => s + Number(e.amount), 0);
  const share = members.length ? Math.round(shared / members.length) : 0;
  const paid = members.map(m => { const p = rows.filter(e => e.created_by === m.user_id).reduce((s, e) => s + Number(e.amount), 0); return { user_id: m.user_id, name: m.display_name, paid: p, balance: p - share }; });
  const creditors = paid.filter(p => p.balance > 0).map(p => ({ ...p })).sort((a, b) => b.balance - a.balance);
  const debtors = paid.filter(p => p.balance < 0).map(p => ({ ...p, balance: -p.balance })).sort((a, b) => b.balance - a.balance);
  const transfers: Settle['transfers'] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].balance, creditors[j].balance);
    if (amount > 0) transfers.push({ from: debtors[i].name, to: creditors[j].name, amount });
    debtors[i].balance -= amount; creditors[j].balance -= amount;
    if (debtors[i].balance <= 0) i++;
    if (creditors[j].balance <= 0) j++;
  }
  return { shared, share, paid, transfers };
}
