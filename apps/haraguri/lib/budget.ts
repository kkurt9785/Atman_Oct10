import type { Budget, Expense } from './model';
import { daysInMonth, total } from './model';

export type BudgetStatus = {
  budget: Budget | null; total: number; spent: number; remaining: number; percent: number; daysLeft: number; perDay: number;
  byCategory: { name: string; budget: number; spent: number; percent: number }[];
};

// The newest budget row at or before the month applies (a budget carries forward until it is changed).
export function budgetFor(budgets: Budget[], month: string): Budget | null {
  const first = `${month}-01`;
  return [...budgets].filter(b => b.month.slice(0, 10) <= first).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null;
}

// Remaining budget split over the days left in the month, like the "오늘은 N원까지" guidance in mainstream ledgers.
export function budgetStatus(budgets: Budget[], expenses: Expense[], month: string, today: string): BudgetStatus {
  const budget = budgetFor(budgets, month);
  const spent = total(expenses, month);
  const totalBudget = budget?.total ?? 0;
  const remaining = totalBudget - spent;
  const dim = daysInMonth(month);
  const daysLeft = today.slice(0, 7) === month ? dim - Number(today.slice(8)) + 1 : today.slice(0, 7) < month ? dim : 0;
  const perDay = daysLeft > 0 ? Math.max(0, Math.floor(remaining / daysLeft)) : 0;
  const byCategory = Object.entries(budget?.by_category ?? {}).filter(([, v]) => Number(v) > 0).map(([name, v]) => {
    const catSpent = expenses.filter(e => e.date.startsWith(month) && e.kind !== 'income' && e.kind !== 'transfer' && e.category === name).reduce((s, e) => s + Number(e.amount), 0);
    return { name, budget: Number(v), spent: catSpent, percent: Math.round(catSpent / Number(v) * 100) };
  }).sort((a, b) => b.percent - a.percent);
  return { budget, total: totalBudget, spent, remaining, percent: totalBudget > 0 ? Math.round(spent / totalBudget * 100) : 0, daysLeft, perDay, byCategory };
}
