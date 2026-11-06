'use client';
import { cardLines, monthLabel, weekLine, won, type Digest, type MonthCard } from '../lib/monthcard';
import { categoryIcon, shiftMonth } from '../lib/finance';
import { money } from '../lib/model';

// Category bars under the big numbers: icon · name · bar · amount, every category the month touched (기타 reads as '분류 안 됨').
// Tapping a bar opens the feed filtered to that category, so an unfiled row is one tap from its '분류 넣기' chip.
export function CategoryBars({ rows, onPick }: { rows: MonthCard['byCategory']; onPick?: (name: string) => void }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map(r => Math.abs(r.amount)));
  return <ul className="cat-bars" aria-label="분류별 지출">{rows.map(c => {
    const other = c.name === '기타';
    const body = <><span className="cat-ico" aria-hidden="true">{categoryIcon[c.name] ?? '•'}</span><span className="cat-name">{other ? '분류 안 됨' : c.name}</span><span className="bar"><i className={other ? 'other' : undefined} style={{ width: `${Math.max(2, Math.round(Math.abs(c.amount) / max * 100))}%` }}/></span><b>{won(c.amount)}</b><small>{Math.round(c.share * 100)}% · {c.count}건{other && onPick ? ' · 눌러서 분류 넣기' : ''}</small></>;
    return <li key={c.name}>{onPick ? <button type="button" className="cat-row" onClick={() => onPick(c.name)}>{body}</button> : <div className="cat-row">{body}</div>}</li>;
  })}</ul>;
}

// Full card for the money tab's 리포트 view: three big numbers, the category bars, then sentences. The old tables live under '자세히' below it.
export function MonthCardView({ card, month, setMonth, onEditBudget, onPickCategory }: { card: MonthCard; month: string; setMonth: (m: string) => void; onEditBudget: () => void; onPickCategory?: (name: string) => void }) {
  // The first line, the per-person split and the budget already sit in the big numbers above; don't say them twice.
  const lines = cardLines(card).slice(1).filter(l => !l.startsWith('예산 ') && l !== card.byMember.map(m => `${m.name} ${won(m.amount)}`).join(' · '));
  return <section className="panel month-card" aria-label={`${monthLabel(month)} 우리 가족`}>
    <div className="month-nav"><button className="icon-button" aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><h2>📬 {monthLabel(month)} 우리 가족</h2><button className="icon-button" aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>
    <div className="big-three">
      <div><span>{card.closed ? '쓴 돈' : '지금까지'}</span><strong>{won(card.total)}</strong><small>{money(card.total)}</small></div>
      <div><span>누가</span><strong>{card.byMember.length ? card.byMember.map(m => `${m.name} ${won(m.amount)}`).join(' · ') : '-'}</strong></div>
      <button type="button" onClick={onEditBudget}><span>예산</span><strong>{card.budgetTotal > 0 ? (card.budgetRemaining >= 0 ? `${won(card.budgetRemaining)} 남음` : `${won(-card.budgetRemaining)} 초과`) : '정하기 →'}</strong></button>
    </div>
    <CategoryBars rows={card.byCategory} onPick={onPickCategory}/>
    <ul className="card-lines">{lines.map(l => <li key={l}>{l}</li>)}</ul>
    {card.total === 0 && <p className="muted">아직 기록이 없어요. 결제가 쌓이면 문장이 늘어나요.</p>}
  </section>;
}

// Compact version that flows through the family chat on the 1st of the month.
export function MonthCardMini({ card, onOpen, onReply }: { card: MonthCard; onOpen?: () => void; onReply?: () => void }) {
  const lines = cardLines(card);
  return <div className="chat-card">
    <b>📬 {monthLabel(card.month)} 우리 가족</b>
    <strong>{won(card.total)}</strong>
    <ul>{lines.slice(0, 5).map(l => <li key={l}>{l}</li>)}</ul>
    <span className="chat-card-actions">{onOpen && <button type="button" className="text-button" onClick={onOpen}>자세히</button>}{onReply && <button type="button" className="text-button" onClick={onReply}>답글</button>}</span>
  </div>;
}

export function WeekLineBubble({ digest, onReply }: { digest: Extract<Digest, { type: 'week' }>; onReply?: () => void }) {
  return <div className="chat-card week"><b>📅 {weekLine(digest)}</b>{onReply && <button type="button" className="text-button" onClick={onReply}>답글</button>}</div>;
}
