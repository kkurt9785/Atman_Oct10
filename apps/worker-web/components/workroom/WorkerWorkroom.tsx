'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isGigworkerSource } from '@/lib/worker-mode';

// 워크룸은 두 셸이 같은 화면을 쓰되(variant), 긱 근무지 방과 병원·약국 방을 서로 보여 주지 않는다.
// 방 안에서는 전체 공지·대화(staff_id null)와 관리자와의 비공개 대화(staff_id = 내 것)를 한 줄로 본다.
// 긱워커는 비공개 대화로만 보내고(DB 트리거가 전체방 글쓰기를 막는다), 병원·약국 직원은 기본이 전체방이며 '관리자에게만'을 켜면 비공개로 보낸다.
// 관리자가 올린 '출석 확인'은 버튼 하나로 답한다 — 단체톡에 "확인했습니다" 치던 일을 대신한다.
type Room = {
  facility_id: string;
  facility_name: string;
  address_text: string | null;
  registration_source: string;
  staff_id: string;
  member_count: number;
  unread_count: number;
  last_message_at: string | null;
};
type Message = {
  id: string;
  facility_id: string;
  staff_id: string | null;
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
function dueLabel(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function WorkerWorkroom({ variant }: { variant: 'gig' | 'medical' }) {
  const params = useSearchParams();
  const requestedFacility = params.get('facility');
  const [userId, setUserId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [replied, setReplied] = useState<Set<string>>(new Set());
  const [replying, setReplying] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [directOnly, setDirectOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const isGig = variant === 'gig';

  useEffect(() => { void (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/'; return; }
    setUserId(user.id);
    const [{ data, error: roomError }, { data: worker }] = await Promise.all([
      supabase.rpc('get_my_workrooms_v2'),
      supabase.from('workers').select('id').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
    ]);
    if (worker?.id) setWorkerId(worker.id);
    if (roomError) { setError('워크룸을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); setLoading(false); return; }
    const all = (data ?? []) as Room[];
    // 알림 URL(/workroom?facility=…)은 공용이라 긱 근무지 알림이 의료 셸로, 또는 그 반대로 올 수 있다. 맞는 셸로 넘긴다.
    const requested = all.find((room) => room.facility_id === requestedFacility);
    if (requested && isGigworkerSource(requested.registration_source) !== isGig) {
      window.location.replace(`${isGig ? '/workroom' : '/gig/workroom'}?facility=${encodeURIComponent(requested.facility_id)}`);
      return;
    }
    const filtered = all.filter((room) => isGigworkerSource(room.registration_source) === isGig);
    setRooms(filtered);
    const next = filtered.find((room) => room.facility_id === requestedFacility)?.facility_id ?? filtered[0]?.facility_id ?? '';
    setSelectedId(next);
    setLoading(false);
  })(); }, [isGig, requestedFacility]);

  const loadMessages = useCallback(async () => {
    if (!selectedId) { setMessages([]); return; }
    const room=rooms.find((item)=>item.facility_id===selectedId);
    let messageQuery=supabase.from('facility_workroom_messages')
      .select('id,facility_id,staff_id,sender_type,sender_user_id,sender_name,message_type,body,metadata,created_at')
      .eq('facility_id', selectedId);
    messageQuery=room?messageQuery.or(`staff_id.is.null,staff_id.eq.${room.staff_id}`):messageQuery.is('staff_id',null);
    const [{ data, error: loadError }, { data: replies }] = await Promise.all([
      messageQuery.order('created_at', { ascending: false }).limit(200),
      workerId ? supabase.from('facility_workroom_check_replies').select('check_id').eq('worker_id', workerId) : Promise.resolve({ data: [] as { check_id: string }[] }),
    ]);
    if (loadError) { setError('워크룸 대화를 불러오지 못했어요.'); return; }
    setMessages(((data ?? []) as Message[]).reverse());
    setReplied(new Set(((replies ?? []) as { check_id: string }[]).map((row) => row.check_id)));
    await Promise.all([
      supabase.rpc('mark_facility_workroom_read', { p_facility_id: selectedId }),
      room?supabase.rpc('mark_staff_workroom_read',{p_staff_id:room.staff_id}):Promise.resolve(),
    ]);
  }, [isGig, rooms, selectedId, workerId]);

  useEffect(() => {
    if (!selectedId) return;
    void loadMessages();
    const room=rooms.find((item)=>item.facility_id===selectedId);
    const channel = supabase.channel(`workroom-worker-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'facility_workroom_messages', filter: `facility_id=eq.${selectedId}` }, (payload) => {
        const row = payload.new as Message;
        if(row.staff_id!==null&&row.staff_id!==room?.staff_id)return;
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
        void supabase.rpc('mark_facility_workroom_read', { p_facility_id: selectedId });
        if(room)void supabase.rpc('mark_staff_workroom_read',{p_staff_id:room.staff_id});
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [isGig, rooms, selectedId, loadMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send() {
    const body = input.trim();
    if (!body || !selectedId || sending) return;
    setSending(true); setError('');
    const room=rooms.find((item)=>item.facility_id===selectedId);
    const { data, error: sendError } = room&&(isGig||directOnly)
      ? await supabase.rpc('send_staff_workroom_message',{p_staff_id:room.staff_id,p_body:body})
      : await supabase.rpc('send_facility_workroom_message', {p_facility_id: selectedId, p_body: body, p_announcement: false});
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

  async function replyCheck(checkId: string) {
    if (replying) return;
    setReplying(checkId); setError('');
    const { error: replyError } = await supabase.rpc('reply_workroom_check', { p_check_id: checkId });
    setReplying(null);
    if (replyError) { setError(replyError.message.replace(/^.*?: /, '')); return; }
    setReplied((current) => new Set(current).add(checkId));
  }

  const selected = rooms.find((room) => room.facility_id === selectedId) ?? null;
  return <main className="flex min-h-[calc(100dvh-5rem)] flex-col bg-bg px-4 pb-4 pt-4">
    <header className="rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <div className="flex items-center justify-between"><span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em]">{isGig ? 'GIG CHAT' : 'WORKROOM'}</span>{selected&&<span className="text-[11px] font-bold text-white/60">함께 {selected.member_count}명</span>}</div>
      <h1 className="mt-4 text-[25px] font-extrabold">{isGig ? '관리자와 근무 대화' : '사업장 워크룸'}</h1>
      <p className="mt-1 text-[12px] leading-5 text-white/65">{isGig ? '전화번호나 카톡 친구 추가 없이 관리자 공지, 출석 확인, 근무 대화를 한곳에 남겨요.' : '카톡 단체방 대신 공지, 출석 확인, 근무 대화, 출퇴근 기록을 한곳에 남겨요.'}</p>
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
            const checkId = message.metadata?.kind === 'check' && typeof message.metadata?.checkId === 'string' ? message.metadata.checkId as string : null;
            if (checkId) {
              const done = replied.has(checkId);
              const due = dueLabel(message.metadata?.dueAt);
              return <div key={message.id} className={`self-stretch rounded-2xl border px-4 py-3 ${done ? 'border-emerald-200 bg-emerald-50' : 'border-primary/25 bg-primary/5'}`}>
                <div className="flex items-center justify-between"><span className={`text-[11px] font-extrabold tracking-[0.1em] ${done ? 'text-emerald-600' : 'text-primary'}`}>출석 확인</span><time className="text-[10px] text-tertiary">{timeLabel(message.created_at)}</time></div>
                <p className="mt-1 whitespace-pre-wrap text-[14px] font-bold leading-5 text-ink">{message.body}</p>
                {due && <p className="mt-1 text-[11px] text-sub">기한 {due}</p>}
                {done
                  ? <p className="mt-3 rounded-xl bg-white px-3 py-2 text-center text-[13px] font-extrabold text-emerald-600">확인했어요 ✓</p>
                  : <button type="button" onClick={() => void replyCheck(checkId)} disabled={replying === checkId} className="mt-3 h-11 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white disabled:opacity-60">{replying === checkId ? '보내는 중...' : '확인했어요'}</button>}
              </div>;
            }
            const mine = message.sender_user_id === userId;
            const notice = message.message_type === 'announcement';
            const direct = message.staff_id !== null;
            return <div key={message.id} className={`max-w-[86%] ${mine?'self-end':'self-start'}`}><p className={`mb-1 text-[10px] font-bold ${mine?'text-right text-primary':'text-sub'}`}>{notice?'공지 · ':''}{direct&&!isGig?'비공개 · ':''}{message.sender_name}</p><div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[14px] leading-5 ${notice?'border border-amber-200 bg-amber-50 text-ink':mine?'rounded-br-md bg-primary text-white':'rounded-bl-md border border-line bg-white text-ink'}`}>{message.body}</div><time className={`mt-1 block text-[10px] text-tertiary ${mine?'text-right':''}`}>{timeLabel(message.created_at)}</time></div>;
          })}
          {messages.length===0&&<div className="py-14 text-center"><p className="text-[14px] font-bold text-ink">아직 대화가 없어요</p><p className="mt-1 text-[12px] text-sub">관리자에게 필요한 내용을 여기서 바로 물어보세요.</p></div>}
        </div><div ref={bottomRef}/>
      </section>}

    {selected&&<section className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] mt-3 rounded-2xl border border-line bg-white p-3 shadow-card"><div className="flex items-end gap-2"><textarea value={input} onChange={(event)=>setInput(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}} maxLength={2000} rows={2} placeholder={isGig ? '관리자에게 근무 메시지 보내기' : directOnly ? '관리자에게만 보내는 메시지' : '관리자와 함께 일하는 분들에게 메시지 보내기'} className="min-h-[48px] flex-1 resize-none rounded-xl bg-bg px-3 py-3 text-[14px] text-ink outline-none"/><button type="button" onClick={()=>void send()} disabled={!input.trim()||sending} className="h-12 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white disabled:opacity-40">전송</button></div>{!isGig&&<label className="mt-2 flex items-center gap-2 px-1 text-[11px] font-bold text-sub"><input type="checkbox" checked={directOnly} onChange={(event)=>setDirectOnly(event.target.checked)} className="h-4 w-4 accent-primary"/>관리자에게만 보내기 (비공개)</label>}<p className="mt-2 px-1 text-[10px] text-tertiary">{isGig?'개인 전화번호는 표시되지 않고, 이 대화는 나와 근무지 관리자만 볼 수 있어요.':directOnly?'이 메시지는 관리자만 볼 수 있어요. 개인 전화번호는 표시되지 않아요.':'개인 전화번호는 표시되지 않아요. 같은 근무지 구성원이 이 대화를 함께 봅니다.'}</p></section>}
  </main>;
}
