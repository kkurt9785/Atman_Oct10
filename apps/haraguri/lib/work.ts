import { Entry, Expense, RoomState, occurrence } from './model';
export type Room = { entry: Entry; date: string } | null;
export function inRoom(item: {entry_id?: string|null; occurrence?: string|null}, room: Room) {
  return (item.entry_id ?? null)===(room?.entry.id ?? null) && (item.occurrence ?? null)===(room?.date ?? null);
}
export function roomState(rooms: RoomState[], room: Room): RoomState | undefined {
  return room ? rooms.find(r => r.entry_id === room.entry.id && r.occurrence === room.date) : undefined;
}
export function isClosed(rooms: RoomState[], room: Room) {
  return !!roomState(rooms, room)?.closed_at;
}
// The work looks finished when this occurrence is marked done or the purchase reached an end state.
export function looksFinished(entry: Entry, date: string, receipts: {entry_id: string; occurrence: string; state: string}[]) {
  if (entry.kind === 'purchase') return entry.purchase_state === 'purchased' || entry.purchase_state === 'hold';
  return receipts.some(r => r.entry_id === entry.id && r.occurrence === date && r.state === 'done');
}
export function workExpenses(expenses:Expense[], room:Exclude<Room,null>) {
  return expenses.filter(e=>inRoom(e,room));
}
export function roomDate(entry:Entry, month:string) {
  return occurrence(entry,month) || entry.date;
}
export const purchaseStates = {discussing:'같이 고민 중',decided:'구매하기로 했어요',purchased:'구매 완료',hold:'보류'};
