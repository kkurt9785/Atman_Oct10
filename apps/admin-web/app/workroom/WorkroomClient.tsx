'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

type Message = {
  id: string;
  facility_id: string;
  sender_type: 'admin' | 'worker' | 'system';
  sender_user_id: string | null;
  sender_name: string;
  message_type: 'message' | 'announcement' | 'attendance' | 'membership' | 'schedule';
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function WorkroomClient({ facilityId, facilityName, memberCount }: { facilityId: string; facilityName: string; memberCount: number }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [announcement, setAnnouncement] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase.from('facility_workroom_messages')
      .select('id,facility_id,sender_type,sender_user_id,sender_name,message_type,body,metadata,created_at')
      .eq('facility_id', facilityId).order('created_at', { ascending: true }).limit(200);
    if (loadError) setError('워크룸을 불러오지 못했어요. 데이터베이스 업데이트 상태를 확인해 주세요.');
    else {
      setMessages((data ?? []) as Message[]);
      await supabase.rpc('mark_facility_workroom_read', { p_facility_id: facilityId });
    }
    setLoading(false);
  }, [facilityId]);

  useEffect(() => {
    void load();
    const channel = supabase.channel(`workroom-admin-${facilityId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'facility_workroom_messages', filter: `facility_id=eq.${facilityId}` }, (payload) => {
        const row = payload.new as Message;
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
        void supabase.rpc('mark_facility_workroom_read', { p_facility_id: facilityId });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [facilityId, load]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true); setError('');
    const { data, error: sendError } = await supabase.rpc('send_facility_workroom_message', {
      p_facility_id: facilityId, p_body: body, p_announcement: announcement,
    });
    setSending(false);
    if (sendError) { setError(sendError.message.replace(/^.*?: /, '')); return; }
    setInput(''); setAnnouncement(false);
    if (data) {
      const row = data as Message;
      setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
    }
    fetch('/api/chat/nudge', { method: 'POST' }).catch(() => undefined);
  }

  return <main className="flex min-h-[calc(100dvh-8.5rem)] flex-col px-4 pb-4">
    <header className="mb-3 rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em]">WORKROOM</span><span className="text-[12px] font-bold text-white/65">연결 {memberCount}명</span></div>
      <h1 className="mt-4 text-[25px] font-extrabold">{facilityName}</h1>
      <p className="mt-1 text-[12px] leading-5 text-white/65">전화번호 대신 여기서 공지하고, 답변과 출퇴근 기록을 함께 확인해요.</p>
    </header>

    <section className="min-h-[360px] flex-1 overflow-y-auto rounded-2xl bg-white px-4 py-4 shadow-sm">
      {loading && <p className="py-16 text-center text-[13px] text-sub">워크룸 기록을 불러오고 있어요...</p>}
      {!loading && messages.length === 0 && <div className="py-16 text-center"><p className="text-[15px] font-bold text-ink">첫 공지를 남겨보세요</p><p className="mt-1 text-[12px] text-sub">가입한 워커의 앱과 푸시 알림으로 전달돼요.</p></div>}
      <div className="flex flex-col gap-3">
        {messages.map((message) => {
          if (message.sender_type === 'system') return <div key={message.id} className={`rounded-2xl px-4 py-3 text-[12px] leading-5 ${message.message_type === 'attendance' ? 'border border-primary/15 bg-primary/5 text-ink' : 'bg-bg text-sub'}`}><p className="font-bold text-primary">{message.sender_name}</p><p>{message.body}</p><time className="mt-1 block text-[10px] text-tertiary">{timeLabel(message.created_at)}</time></div>;
          const mine = message.sender_type === 'admin';
          const notice = message.message_type === 'announcement';
          return <div key={message.id} className={`max-w-[86%] ${mine ? 'self-end' : 'self-start'}`}>
            <p className={`mb-1 text-[10px] font-bold ${mine ? 'text-right text-primary' : 'text-sub'}`}>{notice ? '공지 · ' : ''}{message.sender_name}</p>
            <div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[14px] leading-5 ${notice ? 'border border-amber-200 bg-amber-50 text-ink' : mine ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md border border-line bg-white text-ink'}`}>{message.body}</div>
            <time className={`mt-1 block text-[10px] text-tertiary ${mine ? 'text-right' : ''}`}>{timeLabel(message.created_at)}</time>
          </div>;
        })}
      </div>
      <div ref={bottomRef}/>
    </section>

    <section className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] mt-3 rounded-2xl border border-line bg-white p-3 shadow-card">
      {error && <p role="alert" className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-[12px] font-bold text-red-600">{error}</p>}
      <label className="mb-2 flex items-center gap-2 text-[12px] font-bold text-sub"><input type="checkbox" checked={announcement} onChange={(event)=>setAnnouncement(event.target.checked)} className="h-4 w-4 accent-primary"/>전체 공지로 강조하기</label>
      <div className="flex items-end gap-2">
        <textarea value={input} onChange={(event)=>setInput(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}} maxLength={2000} rows={2} placeholder="공지나 전달사항을 입력하세요" className="min-h-[48px] flex-1 resize-none rounded-xl bg-bg px-3 py-3 text-[14px] text-ink outline-none"/>
        <button type="button" onClick={()=>void send()} disabled={!input.trim()||sending} className="h-12 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white disabled:opacity-40">전송</button>
      </div>
    </section>
  </main>;
}
