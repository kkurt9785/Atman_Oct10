export type Entry = {
  id: string; family_id: string; title: string; body: string; date: string;
  kind: 'task' | 'event' | 'purchase'; expected_amount?: number; purchase_state?: 'discussing' | 'decided' | 'purchased' | 'hold'; repeat: 'none' | 'monthly' | 'yearly';
  assignee: string; created_by: string;
};
export type Member = { user_id: string; display_name: string };
export type Receipt = { id: string; entry_id: string; occurrence: string; user_id: string; state: 'seen' | 'done' };
export type Card = {
  id: string; family_id: string; name: string; holder: string; budget: number; credit_limit: number;
  card_type?: 'credit' | 'debit'; owner_user_id?: string | null; performance_thresholds?: number[];
  benefit_basis?: 'previous_month' | 'current_month'; excluded_categories?: string[]; benefit_note?: string;
};
export type Expense = {
  id: string; family_id: string; card_id: string | null; title: string; amount: number; date: string; category: string; created_by: string;
  entry_id?: string | null; occurrence?: string | null; payment_method?: 'card' | 'bank_transfer' | 'cash' | 'other'; qualifying_amount?: number | null; performance_month?: string | null;
};
export type Comment = { id: string; family_id: string; entry_id: string | null; occurrence: string | null; shared_entry_id?: string | null; shared_occurrence?: string | null; body: string; created_by: string; created_at: string };
export type Attachment = { id: string; family_id: string; entry_id: string | null; occurrence: string | null; created_at?: string; path: string; name: string; size?: number; created_by: string };
export type Family = { id: string; name: string; owner_id: string };
// A closed room keeps its text but its files were removed; writes are blocked until reopened.
export type RoomState = { family_id: string; entry_id: string; occurrence: string; closed_at: string | null; closed_by: string | null; purged_at: string | null; purged_files: number; purged_bytes: number };
// Chat rooms (comments, attachments) are paged separately in lib/chat.ts and are not part of the family snapshot.
export type Data = { entries: Entry[]; members: Member[]; receipts: Receipt[]; cards: Card[]; expenses: Expense[]; rooms: RoomState[] };
export const emptyData: Data = { entries: [], members: [], receipts: [], cards: [], expenses: [], rooms: [] };

// Calendar dates are local date-only values, not UTC timestamps.
export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function occurrence(entry: Entry, month: string): string | null {
  if (entry.date.slice(0, 7) > month) return null;
  if (entry.repeat === 'none') return entry.date.startsWith(month) ? entry.date : null;
  if (entry.repeat === 'yearly' && entry.date.slice(5, 7) !== month.slice(5, 7)) return null;
  const day = Math.min(Number(entry.date.slice(8)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}
export function monthEntries(entries: Entry[], month: string) {
  return entries.flatMap(entry => {
    const date = occurrence(entry, month);
    return date ? [{ entry, date }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}
export function total(expenses: Expense[], prefix: string, cardId?: string) {
  return expenses.filter(e => e.date.startsWith(prefix) && (!cardId || e.card_id === cardId)).reduce((sum, e) => sum + Number(e.amount), 0);
}
export const money = (value: number) => `${value.toLocaleString('ko-KR')}원`;

export function demoData(): Data {
  const date = today(); const month = date.slice(0, 7);
  return {
    members: [{ user_id: 'demo', display_name: '나' }, { user_id: 'partner', display_name: '가족' }],
    entries: [
      { id: 'e1', family_id: 'demo', title: '이번 달 관리비 납부', body: '납부하고 영수증을 여기에 남겨주세요.', date: `${month}-25`, kind: 'task', repeat: 'monthly', assignee: 'demo', created_by: 'demo' },
      { id: 'e2', family_id: 'demo', title: '저녁 먹고 같이 산책해요', body: '오늘 하루 어땠는지 이야기해요.', date, kind: 'event', repeat: 'none', assignee: '', created_by: 'partner' },
      { id: 'p1', family_id:'demo', title:'아이 자전거 같이 고르기', body:'주말에 매장에서 보고 결정해요. 사진과 의견을 여기에 모아요.', date, kind:'purchase', repeat:'none', assignee:'demo', created_by:'demo', expected_amount:200000, purchase_state:'discussing' },
      { id: 'e3', family_id: 'demo', title: '다음 달 가족 여행 준비', body: '가고 싶은 곳과 준비물을 댓글로 모아봐요.', date: `${month}-28`, kind: 'task', repeat: 'none', assignee: '', created_by: 'demo' },
    ],
    receipts: [], cards: [{ id: 'c1', family_id: 'demo', name: '우리 생활비 카드', holder: '가족 공용', budget: 1500000, credit_limit: 5000000, owner_user_id: 'demo', performance_thresholds: [300000,500000], benefit_basis: 'previous_month', excluded_categories: ['세금','관리비'], benefit_note: '예시 카드입니다. 실제 카드의 혜택 조건을 직접 등록하세요.' }],
    expenses: [
      { id: 'x1', family_id: 'demo', card_id: 'c1', title: '동네 마트 장보기', amount: 48300, date, category: '식비', created_by: 'demo' },
      { id: 'x2', family_id: 'demo', card_id: 'c1', title: '아이 학원비', amount: 220000, date: `${month}-01`, category: '교육', created_by: 'demo' },
    ],
    rooms: [],
  };
}
export function demoChat(): { comments: Comment[]; attachments: Attachment[] } {
  const date = today();
  return {
    comments: [
      { id: 'general-1', family_id: 'demo', entry_id: null, occurrence: null, body: '오늘 저녁은 같이 먹어요! 일정이나 살 것은 각각의 대화방에서 이야기해요.', created_by: 'partner', created_at: new Date().toISOString() },
      { id: 'm1', family_id: 'demo', entry_id: 'e2', occurrence: date, body: '좋아요! 제가 먼저 준비할게요.', created_by: 'demo', created_at: new Date().toISOString() },
    ],
    attachments: [],
  };
}
