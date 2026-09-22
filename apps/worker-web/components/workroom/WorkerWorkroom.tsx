'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Room = {
  facility_id: string;
  facility_name: string;
  address_text: string | null;
  registration_source: string;
  member_count: number;
  unread_count: number;
  last_message_at: string | null;
};
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

export function WorkerWorkroom({ variant }: { variant: 'gig' | 'medical' }) {
  const params = useSearchParams();
  const requestedFacility = params.get('facility');
  const [userId, setUserId] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const isGig = variant === 'gig';

  useEffect(() => { void (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/'; return; }
    setUserId(user.id);
    const { data, error: roomError } = await supabase.rpc('get_my_workrooms');
    if (roomError) { setError('워크룸을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); setLoading(false); return; }
    const all = (data ?? []) as Room[];
    // 알림 URL(/workroom?facility=…)은 공용이라 긱 근무지 알림이 의료 셸로, 또는 그 반대로 올 수 있다. 맞는 셸로 넘긴다.
    const requested = all.find((room) => room.facility_id === requestedFacility);
    if (requested && (requested.registration_source === 'gigworker_trial') !== isGig) {
      window.location.replace(`${isGig ? '/workroom' : '/gig/workroom'}?facility=${encodeURIComponent(requested.facility_id)}`);
      return;
    }
    const filtered = all.filter((room) => isGig ? room.registration_source === 'gigworker_trial' : room.registration_source !== 'gigworker_trial');
    setRooms(filtered);
    const next = filtered.find((room) => room.facility_id === requestedFacility)?.facility_id ?? filtered[0]?.facility_id ?? '';
    setSelectedId(next);
    setLoading(false);
  })(); }, [isGig, requestedFacility]);

  const loadMessages = useCallback(async () => {
    if (!selectedId) { setMessages([]); return; }
    const { data, error: loadError } = await supabase.from('facility_workroom_messages')
      .select('id,facility_id,sender_type,sender_user_id,sender_name,message_type,body,metadata,created_at')
      .eq('facility_id', selectedId).order('created_at', { ascending: false }).limit(200);
    if (loadError) { setError('워크룸 대화를 불러오지 못했어요.'); return; }
    setMessages(((data ?? []) as Message[]).reverse());
    await supabase.rpc('mark_facility_workroom_read', { p_facility_id: selectedId });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    void loadMessages();
    const channel = supabase.channel(`workroom-worker-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'facility_workroom_messages', filter: `facility_id=eq.${selectedId}` }, (payload) => {
        const row = payload.new as Message;
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
        void supabase.rpc('mark_facility_workroom_read', { p_facility_id: selectedId });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedId, loadMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    const body = input.trim();
    if (!body || !selectedId || sending) return;
    setSending(true); setError('');
    const { data, error: sendError } = await supabase.rpc('send_facility_workroom_message', {
      p_facility_id: selectedId, p_body: body, p_announcement: false,
    });
    setSending(false);
    if (sendError) { setError(sendError.message.replace(/^.*?: /, '')); return; }
    setInput('');
    if (data) {
      const row = data as Message;
      setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
    }
    const { data: { session } } = await supabase.auth.getSession();
    const adminBase = process.env.NEXT_PUBLIC_ADMIN_WEB_URL ?? (window.location.hostname === 'localhost' ? 'http://localhost:3002' : 'https://admin.itdot.co.kr');
    if (session) fetch(`${adminBase}/api/attendance/nudge`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, keepalive: true }).catch(() => undefined);
  }

  const selected = rooms.find((room) => room.facility_id === selectedId) ?? null;
  return <main className="flex min-h-[calc(100dvh-5rem)] flex-col bg-bg px-4 pb-4 pt-4">
    <header className="rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <div className="flex items-center justify-between"><span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em]">WORKROOM</span>{selected&&<span className="text-[11px] font-bold text-white/60">함께 {selected.member_count}명</span>}</div>
      <h1 className="mt-4 text-[25px] font-extrabold">사업장 워크룸</h1>
      <p className="mt-1 text-[12px] leading-5 text-white/65">카톡 단체방 대신 공지, 근무 대화, 출퇴근 기록을 한곳에 남겨요.</p>
      {rooms.length > 1 && <select value={selectedId} onChange={(event)=>setSelectedId(event.target.value)} className="mt-4 h-11 w-full rounded-xl border border-white/10 bg-white/10 px-3 text-[13px] font-bold text-white outline-none">{rooms.map((room)=><option key={room.facility_id} value={room.facility_id} className="text-ink">{room.facility_name}{room.unread_count?` · 새 소식 ${room.unread_count}`:''}</option>)}</select>}
    </header>

    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12px] font-bold text-red-600">{error}</p>}
    {loading ? <div className="mt-4 flex-1 rounded-2xl bg-white py-20 text-center text-[13px] text-sub">워크룸을 불러오고 있어요...</div>
      : !selected ? <section className="mt-4 flex-1 rounded-2xl bg-white px-6 py-16 text-center"><p className="text-[16px] font-extrabold text-ink">아직 참여한 워크룸이 없어요</p><p className="mt-2 text-[13px] leading-5 text-sub">관리자의 일회용 가입 링크나 현장 QR을 열면 전화번호 없이 사업장과 연결돼요.</p></section>
      : <section className="mt-3 min-h-[360px] flex-1 overflow-y-auto rounded-2xl bg-white px-4 py-4 shadow-sm">
        <div className="mb-4 border-b border-line pb-3"><p className="text-[15px] font-extrabold text-ink">{selected.facility_name}</p>{selected.address_text&&<p className="mt-0.5 text-[11px] text-sub">{selected.address_text}</p>}</div>
        <div className="flex flex-col gap-3">
          {messages.map((message) => {
            if (message.sender_type === 'system') return <div key={message.id} className={`rounded-2xl px-4 py-3 text-[12px] leading-5 ${message.message_type==='attendance'?'border border-primary/15 bg-primary/5 text-ink':'bg-bg text-sub'}`}><p className="font-bold text-primary">{message.sender_name}</p><p>{message.body}</p><time className="mt-1 block text-[10px] text-tertiary">{timeLabel(message.created_at)}</time></div>;
            const mine = message.sender_user_id === userId;
            const notice = message.message_type === 'announcement';
            return <div key={message.id} className={`max-w-[86%] ${mine?'self-end':'self-start'}`}><p className={`mb-1 text-[10px] font-bold ${mine?'text-right text-primary':'text-sub'}`}>{notice?'공지 · ':''}{message.sender_name}</p><div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[14px] leading-5 ${notice?'border border-amber-200 bg-amber-50 text-ink':mine?'rounded-br-md bg-primary text-white':'rounded-bl-md border border-line bg-white text-ink'}`}>{message.body}</div><time className={`mt-1 block text-[10px] text-tertiary ${mine?'text-right':''}`}>{timeLabel(message.created_at)}</time></div>;
          })}
          {messages.length===0&&<div className="py-14 text-center"><p className="text-[14px] font-bold text-ink">아직 대화가 없어요</p><p className="mt-1 text-[12px] text-sub">관리자에게 필요한 내용을 여기서 바로 물어보세요.</p></div>}
        </div><div ref={bottomRef}/>
      </section>}

    {selected&&<section className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] mt-3 rounded-2xl border border-line bg-white p-3 shadow-card"><div className="flex items-end gap-2"><textarea value={input} onChange={(event)=>setInput(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}} maxLength={2000} rows={2} placeholder="관리자와 함께 일하는 분들에게 메시지 보내기" className="min-h-[48px] flex-1 resize-none rounded-xl bg-bg px-3 py-3 text-[14px] text-ink outline-none"/><button type="button" onClick={()=>void send()} disabled={!input.trim()||sending} className="h-12 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white disabled:opacity-40">전송</button></div><p className="mt-2 px-1 text-[10px] text-tertiary">개인 전화번호는 워크룸에 표시되지 않아요. 대화와 근태 기록은 사업장에 보관됩니다.</p></section>}
  </main>;
}
