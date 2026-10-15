'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useMatchChat } from '@/lib/use-match-chat';
import { MessageSafetyActions } from './MessageSafetyActions';

type Props = { client: SupabaseClient; applicationId: string; variant: 'worker' | 'admin'; title: string; subtitle: string };
const timeLabel = (value: string) => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value));
export function MatchChatView({ client, applicationId, variant, title, subtitle }: Props) {
  const chat = useMatchChat(client, applicationId);
  const [notice, setNotice] = useState('');
  const bottom = useRef<HTMLDivElement>(null), newest = chat.messages.at(-1)?.id;
  useEffect(() => { if (newest) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [newest]);
  const replies = variant === 'worker' ? ['확인했습니다. 감사합니다.', '예정 시간에 도착하겠습니다.', '준비물을 다시 알려주세요.'] : ['채용이 확정됐어요.', '예정 시간에 와주세요.', '도착하면 채팅 남겨주세요.'];
  async function send() {
    if (!await chat.send()) return;
    if (variant === 'admin') { void fetch('/api/chat/nudge', { method: 'POST' }).catch(() => undefined); return; }
    try {
      const { data: { session } } = await client.auth.getSession();
      const base = process.env.NEXT_PUBLIC_ADMIN_WEB_URL ?? (window.location.hostname === 'localhost' ? 'http://localhost:3002' : 'https://admin.itdot.co.kr');
      if (session) void fetch(`${base}/api/attendance/nudge`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, keepalive: true }).catch(() => undefined);
    } catch { /* Notification retries are managed by the outbox. */ }
  }
  return <main className="flex h-dvh min-h-0 flex-col bg-bg">
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
      <Link href={variant === 'worker' ? '/applications' : '/chats'} aria-label="대화 목록으로 돌아가기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[22px] text-ink">←</Link>
      <div className="min-w-0 flex-1"><h1 className="truncate text-[17px] font-extrabold text-ink">{title}</h1><p className="mt-1 text-[12px] leading-5 text-sub">{subtitle}</p></div>
      <Link href="/safety" className="inline-flex min-h-11 shrink-0 items-center text-[12px] font-bold text-sub underline">차단 관리</Link>
    </header>
    {notice && <p role="status" className="shrink-0 bg-primary/5 px-4 py-3 text-[14px] font-bold text-primary">{notice}</p>}
    {chat.connectionIssue && !chat.loadError && <div role="status" className="shrink-0 bg-amber-50 px-4 py-2 text-[13px] text-sub">자동 갱신이 지연돼요. <button type="button" onClick={() => void chat.load()} className="min-h-11 font-bold text-primary underline">새로 불러오기</button></div>}
    <section aria-label="대화 내용" aria-busy={chat.loading} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 py-4">
      {chat.loading ? <p role="status" className="m-auto text-[14px] text-sub">대화를 불러오고 있어요…</p>
        : chat.loadError ? <div role="alert" className="m-auto max-w-sm text-center"><p className="text-[15px] font-bold text-ink">{chat.loadError}</p><button type="button" onClick={() => void chat.load()} className="mt-3 min-h-12 rounded-xl bg-primary px-5 text-[15px] font-bold text-white">다시 불러오기</button><Link href={variant === 'admin' ? '/login' : '/'} className="mt-2 flex min-h-11 items-center justify-center text-[14px] font-bold text-sub">로그인 화면</Link></div>
        : chat.messages.length === 0 ? <div className="m-auto text-center"><p className="text-[15px] font-bold text-ink">아직 대화가 없어요</p><p className="mt-2 text-[13px] leading-5 text-sub">{chat.open ? '아래에서 메시지를 남겨 보세요.' : '대화방이 닫혔거나 표시할 메시지가 없어요.'}</p></div>
        : <>
          {chat.hasMore && <button type="button" onClick={() => void chat.loadOlder()} disabled={chat.loadingOlder} className="min-h-11 shrink-0 self-center rounded-xl bg-white px-5 text-[14px] font-bold text-primary">{chat.loadingOlder ? '불러오는 중…' : '이전 대화 더 보기'}</button>}
          {chat.messages.map(message => {
            if (message.sender_type === 'system') return <p key={message.id} className="shrink-0 whitespace-pre-wrap break-words rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 text-[13px] leading-6 text-ink [overflow-wrap:anywhere]">{message.body}</p>;
            const mine = message.sender_id === chat.userId, label = message.sender_type === 'worker' ? '근무자' : '사업장 담당자';
            return <article key={message.id} className={`max-w-[85%] shrink-0 ${mine ? 'self-end' : 'self-start'}`}>
              <p className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[15px] leading-6 [overflow-wrap:anywhere] ${mine ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md border border-line bg-white text-ink'}`}>{message.body}</p>
              <div className={`flex items-center gap-1 ${mine ? 'justify-end' : ''}`}><time className="text-[11px] text-sub">{timeLabel(message.created_at)}</time>{!mine && <MessageSafetyActions source="match" messageId={message.id} authorId={message.sender_id} label={label} onChanged={value => { setNotice(value); void chat.load(); }} />}</div>
            </article>;
          })}
        </>}
      <div ref={bottom} />
    </section>
    <footer className="shrink-0 border-t border-line bg-white px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
      {chat.actionError && <p role="alert" className="mb-2 text-[14px] font-bold text-red-600">{chat.actionError}</p>}
      {!chat.loading && !chat.loadError && !chat.open ? <p className="py-3 text-center text-[14px] text-sub">종료된 대화예요. 남아 있는 기록은 계속 확인할 수 있어요.</p> : <>
        <div className="mb-2 flex gap-2 overflow-x-auto">{replies.map(reply => <button key={reply} type="button" disabled={chat.loading || !!chat.loadError || chat.sending} onClick={() => chat.setInput(reply)} className="min-h-11 shrink-0 rounded-full border border-line px-3 text-[12px] font-bold text-sub disabled:opacity-40">{reply}</button>)}</div>
        <div className="flex gap-2"><input aria-label="메시지" value={chat.input} maxLength={2000} onChange={event => chat.setInput(event.target.value)} disabled={chat.loading || !!chat.loadError} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="메시지를 입력해 주세요" className="h-12 min-w-0 flex-1 rounded-xl bg-bg px-3 text-[16px] text-ink" />
          <button type="button" onClick={() => void send()} disabled={!chat.input.trim() || chat.sending || !chat.open || chat.loading || !!chat.loadError} className="h-12 shrink-0 rounded-xl bg-primary px-4 text-[15px] font-bold text-white disabled:opacity-40">{chat.sending ? '전송 중…' : '전송'}</button></div>
      </>}
    </footer>
  </main>;
}
