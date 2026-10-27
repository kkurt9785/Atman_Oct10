import { Entry, Expense, occurrence } from './model';
export type Room = { entry: Entry; date: string } | null;
export function inRoom(item: {entry_id?: string|null; occurrence?: string|null}, room: Room) {
  return (item.entry_id ?? null)===(room?.entry.id ?? null) && (item.occurrence ?? null)===(room?.date ?? null);
}
export function workExpenses(expenses:Expense[], room:Exclude<Room,null>) {
  return expenses.filter(e=>inRoom(e,room));
}
export function roomDate(entry:Entry, month:string) {
  return occurrence(entry,month) || entry.date;
}
export const purchaseStates = {discussing:'같이 고민 중',decided:'구매하기로 했어요',purchased:'구매 완료',hold:'보류'};
