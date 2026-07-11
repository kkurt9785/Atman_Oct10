'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';

type Message = {
  id: string;
  sender_type: 'worker' | 'facility' | 'system';
  body: string;
  created_at: string;
};

function timeLabel(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function AdminChatPage() {
  const router = useRouter();
  const { applicationId } = useParams<{ applicationId: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [{ data: rows }, { data: isOpen }] = await Promise.all([
      supabase.from('chat_messages')
        .select('id, sender_type, body, created_at')
        .eq('application_id', applicationId)
        .order('created_at'),
      supabase.rpc('chat_is_open', { p_application_id: applicationId }),
    ]);
    setMessages((rows ?? []) as Message[]);
    setOpen(isOpen === true);
  }, [applicationId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`chat-${applicationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `application_id=eq.${applicationId}`,
      }, (payload) => {
        setMessages((prev) =>
          prev.some((m) => m.id === (payload.new as Message).id)
            ? prev
            : [...prev, payload.new as Message]
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [applicationId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    const { data, error: err } = await supabase.rpc('send_chat_message', {
      p_application_id: applicationId,
      p_body: body,
    });
    setSending(false);
    if (err) {
      setError(err.message.replace(/^.*: /, ''));
      return;
    }
    setInput('');
    if (data) {
      setMessages((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data as Message]);
    }
    // 워커 푸시 즉시 발송 (Hobby cron 보완)
    fetch('/api/chat/nudge', { method: 'POST' }).catch(() => undefined);
  }

  return (
    <div className="flex flex-col h-screen bg-bg">
      <div className="bg-white px-5 pt-4 pb-3 flex items-center gap-3 border-b border-line flex-shrink-0">
        <button onClick={() => router.back()} className="text-ink text-[20px] leading-none -ml-1 p-1">←</button>
        <div className="flex-1">
          <h1 className="text-[16px] font-extrabold text-ink">워커 채팅</h1>
          <p className="text-[11px] text-tertiary">개인 연락처 공유 대신 채팅을 이용해 주세요 · 기록 보관</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
        {messages.map((m) =>
          m.sender_type === 'system' ? (
            <div key={m.id} className="bg-primary/5 border border-primary/15 rounded-2xl px-4 py-3 text-[13px] text-ink whitespace-pre-line">
              {m.body}
            </div>
          ) : (
            <div key={m.id} className={`max-w-[78%] ${m.sender_type === 'facility' ? 'self-end' : 'self-start'}`}>
              <div className={`rounded-2xl px-3.5 py-2.5 text-[14px] whitespace-pre-line ${
                m.sender_type === 'facility' ? 'bg-primary text-white rounded-br-md' : 'bg-white text-ink border border-line rounded-bl-md'
              }`}>
                {m.body}
              </div>
              <p className={`text-[10px] text-tertiary mt-0.5 ${m.sender_type === 'facility' ? 'text-right' : ''}`}>
                {m.sender_type === 'worker' ? '워커 · ' : ''}{timeLabel(m.created_at)}
              </p>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>

      <div className="bg-white border-t border-line px-4 pt-3 pb-6 flex-shrink-0">
        {error && <p className="text-[12px] font-bold text-red-500 mb-2">{error}</p>}
        {open ? (
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
              placeholder="메시지 입력"
              className="flex-1 h-11 px-4 bg-bg rounded-xl text-[14px] text-ink outline-none"
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className="h-11 px-4 rounded-xl bg-primary text-white text-[14px] font-bold disabled:opacity-40 flex-shrink-0"
            >
              전송
            </button>
          </div>
        ) : (
          <p className="text-[13px] text-tertiary text-center py-2">🔒 종료된 채팅이에요 — 기록은 계속 확인할 수 있어요</p>
        )}
      </div>
    </div>
  );
}
