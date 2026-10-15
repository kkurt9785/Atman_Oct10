'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BackButton } from '@/components/BackButton';
import { GigInviteAction } from '@/components/invite/GigInviteAction';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isGigKind } from '@/lib/worker-mode';
import Link from 'next/link';
import { loadWorkroomPage } from '@/lib/workroom-messages';
import { MessageSafetyActions } from '@/components/safety/MessageSafetyActions';

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
  worker_kind: string;
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
  const [roomLoadFailed, setRoomLoadFailed] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [notice, setNotice] = useState('');
  const sendLock = useRef(false), replyLock = useRef(false), olderLock = useRef(false), messageSequence = useRef(0);
  const currentRoom = useRef(selectedId), messageRows = useRef(messages);
  currentRoom.current = selectedId; messageRows.current = messages;
  const drafts = useRef(new Map<string, string>());
  useEffect(() => { setInput(drafts.current.get(selectedId) ?? ''); setError(''); setNotice(''); }, [selectedId]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isGig = variant === 'gig';

  useEffect(() => { let active = true; setLoading(true); setRoomLoadFailed(false); setError(''); void (async () => {
    try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('로그인 상태를 확인하지 못했어요. 다시 로그인하거나 잠시 후 다시 시도해 주세요.');
    if (!active) return;
    setUserId(user.id);
    const [{ data, error: roomError }, { data: worker, error: workerError }] = await Promise.all([
      supabase.rpc('get_my_workrooms_v2'),
      supabase.from('workers').select('id').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
    ]);
    if (roomError || workerError || !Array.isArray(data)) throw new Error('워크룸을 불러오지 못했어요. 다시 시도해 주세요.');
    if (!active) return;
    if (worker?.id) setWorkerId(worker.id);
    const all = (data ?? []) as Room[];
    // 알림 URL(/workroom?facility=…)은 공용이라 긱 근무지 알림이 의료 셸로, 또는 그 반대로 올 수 있다. 맞는 셸로 넘긴다.
    const requested = all.find((room) => room.facility_id === requestedFacility);
    if (requested && isGigKind(requested.worker_kind) !== isGig) {
      window.location.replace(`${isGig ? '/workroom' : '/gig/workroom'}?facility=${encodeURIComponent(requested.facility_id)}`);
      return;
    }
    const filtered = all.filter((room) => isGigKind(room.worker_kind) === isGig);
    setRooms(filtered);
    const next = filtered.find((room) => room.facility_id === requestedFacility)?.facility_id ?? filtered[0]?.facility_id ?? '';
    setSelectedId(next);
    } catch (caught) { if (active) { setRoomLoadFailed(true); setError(caught instanceof Error ? caught.message : '워크룸을 불러오지 못했어요.'); } }
    finally { if (active) setLoading(false); }
  })(); return () => { active = false; }; }, [isGig, requestedFacility]);

  const loadMessages = useCallback(async (older = false) => {
    if (!selectedId) { setMessages([]); return; }
    if (older && olderLock.current) return;
    const request = ++messageSequence.current;
    if (older) { olderLock.current = true; setLoadingOlder(true); }
    else { setMessageLoading(true); setMessages([]); setLoadingOlder(false); olderLock.current = false; }
    setMessageError('');
    const room=rooms.find((item)=>item.facility_id===selectedId);
    try {
    const page = await loadWorkroomPage(supabase, { facilityId: selectedId, staffId: room?.staff_id ?? null, includeGroup: true }, older ? messageRows.current[0] : undefined);
    const checkIds = page.messages.flatMap(row => typeof row.metadata?.checkId === 'string' ? [row.metadata.checkId] : []);
    const { data: replies, error: replyError } = workerId && checkIds.length
      ? await supabase.from('facility_workroom_check_replies').select('check_id').eq('worker_id', workerId).in('check_id', checkIds)
      : { data: [], error: null };
    if (replyError) throw new Error('출석 확인 상태를 불러오지 못했어요. 다시 시도해 주세요.');
    if (request !== messageSequence.current) return;
    setMessages(current => [...new Map([...page.messages, ...current].map(row => [row.id, row])).values()].sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id)));
    setHasMore(page.hasMore);
    setReplied(current => new Set([...(older ? current : []), ...((replies ?? []) as { check_id: string }[]).map(row => row.check_id)]));
    void Promise.all([
      supabase.rpc('mark_facility_workroom_read', { p_facility_id: selectedId }),
      room?supabase.rpc('mark_staff_workroom_read',{p_staff_id:room.staff_id}):Promise.resolve(),
    ]).catch(() => undefined);
    } catch (caught) { if (request === messageSequence.current) setMessageError(caught instanceof Error ? caught.message : '대화를 불러오지 못했어요.'); }
    finally { if (request === messageSequence.current) { setMessageLoading(false); setLoadingOlder(false); } if (older) olderLock.current = false; }
  }, [isGig, rooms, selectedId, workerId]);

  useEffect(() => {
    if (!selectedId) return;
    void loadMessages();
    const room=rooms.find((item)=>item.facility_id===selectedId);
    const channel = supabase.channel(`workroom-worker-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'facility_workroom_messages', filter: `facility_id=eq.${selectedId}` }, (payload) => {
        if (currentRoom.current !== selectedId) return;
        const row = payload.new as Message;
        if(row.staff_id!==null&&row.staff_id!==room?.staff_id)return;
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
        void supabase.rpc('mark_facility_workroom_read', { p_facility_id: selectedId });
        if(room)void supabase.rpc('mark_staff_workroom_read',{p_staff_id:room.staff_id});
      }).subscribe();
    return () => { messageSequence.current += 1; void supabase.removeChannel(channel); };
  }, [isGig, rooms, selectedId, loadMessages]);

  const newestMessage = messages.at(-1)?.id;
  useEffect(() => { if (newestMessage) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [newestMessage]);

  async function send() {
    const draft = input, body = draft.trim(), roomId = selectedId;
    if (!body || !selectedId || sendLock.current || messageLoading || messageError) return;
    sendLock.current = true;
    setSending(true); setError('');
    try {
    const room=rooms.find((item)=>item.facility_id===selectedId);
    const { data, error: sendError } = room&&(isGig||directOnly)
      ? await supabase.rpc('send_staff_workroom_message',{p_staff_id:room.staff_id,p_body:body})
      : await supabase.rpc('send_facility_workroom_message', {p_facility_id: selectedId, p_body: body, p_announcement: false});
    if (sendError) { setError(sendError.message.replace(/^.*?: /, '')); return; }
    if (!data || typeof data.id !== 'string') throw new Error('전송 결과를 확인하지 못했어요. 대화를 새로 불러와 주세요.');
    if (currentRoom.current === roomId) {
      if (drafts.current.get(roomId) === draft) drafts.current.delete(roomId);
      setInput(current => current === draft ? '' : current);
      const row = data as Message;
      setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
    }
    void supabase.auth.getSession().then(({ data: { session } }) => {
    const adminBase = process.env.NEXT_PUBLIC_ADMIN_WEB_URL ?? (window.location.hostname === 'localhost' ? 'http://localhost:3002' : 'https://admin.itdot.co.kr');
    if (session) void fetch(`${adminBase}/api/attendance/nudge`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, keepalive: true }).catch(() => undefined);
    }).catch(() => undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '메시지를 보내지 못했어요. 입력한 내용은 유지돼요.'); }
    finally { sendLock.current = false; setSending(false); }
  }

  async function replyCheck(checkId: string) {
    if (replyLock.current) return;
    replyLock.current = true;
    setReplying(checkId); setError('');
    try {
    const { error: replyError } = await supabase.rpc('reply_workroom_check', { p_check_id: checkId });
    if (replyError) { setError(replyError.message.replace(/^.*?: /, '')); return; }
    setReplied((current) => new Set(current).add(checkId));
    } catch { setError('답변을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { replyLock.current = false; setReplying(null); }
  }

  const selected = rooms.find((room) => room.facility_id === selectedId) ?? null;
  return <main className="flex min-h-[calc(100dvh-5rem)] flex-col bg-bg px-4 pb-4 pt-4">
    {!isGig && <div className="mb-2"><BackButton href="/workplace" label="내 직장" anyPrevious /></div>}
    <header className="rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <div className="flex items-start justify-between gap-3"><h1 className="text-[25px] font-extrabold">{isGig ? '사장님과 근무 대화' : '사업장 워크룸'}</h1>{selected&&<span className="mt-2 shrink-0 text-[11px] font-bold text-white/60">함께 {selected.member_count}명</span>}</div>
      <p className="mt-1 text-[12px] leading-5 text-white/65">{isGig ? '전화번호나 카톡 친구 추가 없이 공지, 출석 확인, 근무 대화를 한곳에 남겨요.' : '카톡 단체방 대신 공지, 출석 확인, 근무 대화, 출퇴근 기록을 한곳에 남겨요.'}</p>
      {rooms.length > 1 && <select value={selectedId} onChange={(event)=>setSelectedId(event.target.value)} className="mt-4 h-11 w-full rounded-xl border border-white/10 bg-white/10 px-3 text-[13px] font-bold text-white outline-none">{rooms.map((room)=><option key={room.facility_id} value={room.facility_id} className="text-ink">{room.facility_name}{room.unread_count?` · 새 소식 ${room.unread_count}`:''}</option>)}</select>}
    </header>

    <Link href="/safety" className="mt-2 inline-flex min-h-11 items-center self-end text-[13px] font-bold text-sub underline">대화 안전·차단 관리</Link>
    {notice && <p role="status" className="mt-2 rounded-xl bg-primary/5 px-3 py-3 text-[14px] font-bold text-primary">{notice}</p>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[14px] font-bold text-red-600">{error}</p>}
    {loading ? <div className="mt-4 flex-1 rounded-2xl bg-white py-20 text-center text-[13px] text-sub">워크룸을 불러오고 있어요...</div>
      : roomLoadFailed ? <section className="mt-4 rounded-2xl bg-white p-6 text-center"><button type="button" onClick={() => window.location.reload()} className="min-h-12 rounded-xl bg-primary px-5 text-[15px] font-bold text-white">다시 불러오기</button><Link href="/" className="mt-2 flex min-h-11 items-center justify-center text-[14px] font-bold text-sub">로그인 화면</Link></section>
      : !selected ? <section className="mt-4 flex-1 rounded-2xl bg-white px-6 py-16 text-center"><p className="text-[16px] font-extrabold text-ink">{isGig ? '아직 연결된 대화방이 없어요' : '아직 참여한 워크룸이 없어요'}</p><p className="mt-2 text-[13px] leading-5 text-sub">{isGig ? '사장님이 보낸 초대 링크나 현장 QR을 열면 전화번호 없이 연결돼요.' : '관리자의 일회용 가입 링크나 현장 QR을 열면 전화번호 없이 사업장과 연결돼요.'}</p>{isGig && <GigInviteAction />}</section>
      : <section className="mt-3 min-h-[360px] flex-1 overflow-y-auto rounded-2xl bg-white px-4 py-4 shadow-sm">
        <div className="mb-4 border-b border-line pb-3"><p className="text-[15px] font-extrabold text-ink">{selected.facility_name}</p>{selected.address_text&&<p className="mt-0.5 text-[11px] text-sub">{selected.address_text}</p>}</div>
        {messageLoading && <p role="status" className="py-10 text-center text-[14px] text-sub">대화를 불러오고 있어요…</p>}
        {messageError && <div role="alert" className="py-4"><p className="text-[14px] text-red-600">{messageError}</p><button type="button" onClick={() => void loadMessages()} className="mt-2 min-h-11 rounded-xl bg-bg px-4 text-[14px] font-bold">다시 불러오기</button></div>}
        {hasMore && !messageLoading && <button type="button" disabled={loadingOlder} onClick={() => void loadMessages(true)} className="mb-3 min-h-11 w-full rounded-xl bg-bg text-[14px] font-bold text-primary">{loadingOlder ? '불러오는 중…' : '이전 대화 더 보기'}</button>}
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
                  : <button type="button" onClick={() => void replyCheck(checkId)} disabled={replying !== null || messageLoading || !!messageError} className="mt-3 h-11 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white disabled:opacity-60">{replying === checkId ? '보내는 중...' : '확인했어요'}</button>}
                {message.sender_user_id !== userId && <MessageSafetyActions source="workroom" messageId={message.id} authorId={message.sender_user_id} label={message.sender_name} onChanged={value => { setNotice(value); void loadMessages(); }} />}
              </div>;
            }
            const mine = message.sender_user_id === userId;
            const notice = message.message_type === 'announcement';
            const direct = message.staff_id !== null;
            return <div key={message.id} className={`max-w-[86%] ${mine?'self-end':'self-start'}`}><p className={`mb-1 text-[10px] font-bold ${mine?'text-right text-primary':'text-sub'}`}>{notice?'공지 · ':''}{direct&&!isGig?'비공개 · ':''}{message.sender_name}</p><div className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[15px] leading-6 [overflow-wrap:anywhere] ${notice?'border border-amber-200 bg-amber-50 text-ink':mine?'rounded-br-md bg-primary text-white':'rounded-bl-md border border-line bg-white text-ink'}`}>{message.body}</div><time className={`mt-1 block text-[10px] text-tertiary ${mine?'text-right':''}`}>{timeLabel(message.created_at)}</time>{message.sender_user_id !== userId && <MessageSafetyActions source="workroom" messageId={message.id} authorId={message.sender_user_id} label={message.sender_name} onChanged={value => { setNotice(value); void loadMessages(); }} />}</div>;
          })}
          {!messageLoading&&!messageError&&messages.length===0&&<div className="py-14 text-center"><p className="text-[14px] font-bold text-ink">아직 대화가 없어요</p><p className="mt-1 text-[12px] text-sub">{isGig ? '사장님께' : '관리자에게'} 필요한 내용을 여기서 바로 물어보세요.</p></div>}
        </div><div ref={bottomRef}/>
      </section>}

    {selected&&<section className="sticky bottom-[calc(64px+var(--demo-bar,0px)+env(safe-area-inset-bottom))] mt-3 rounded-2xl border border-line bg-white p-3 shadow-card"><div className="flex items-end gap-2"><textarea aria-label="워크룸 메시지" value={input} disabled={messageLoading || !!messageError} onChange={(event)=>{ setInput(event.target.value); drafts.current.set(selectedId,event.target.value); }} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}} maxLength={2000} rows={2} placeholder={isGig ? '관리자에게 근무 메시지 보내기' : directOnly ? '관리자에게만 보내는 메시지' : '관리자와 함께 일하는 분들에게 메시지 보내기'} className="min-h-[48px] min-w-0 flex-1 resize-none rounded-xl bg-bg px-3 py-3 text-[16px] text-ink outline-none"/><button type="button" onClick={()=>void send()} disabled={!input.trim()||sending||messageLoading||!!messageError} className="h-12 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white disabled:opacity-40">전송</button></div>{!isGig&&<label className="mt-2 flex items-center gap-2 px-1 text-[11px] font-bold text-sub"><input type="checkbox" checked={directOnly} onChange={(event)=>setDirectOnly(event.target.checked)} className="h-4 w-4 accent-primary"/>관리자에게만 보내기 (비공개)</label>}<p className="mt-2 px-1 text-[10px] text-tertiary">{isGig?'개인 전화번호는 표시되지 않고, 이 대화는 나와 근무지 관리자만 볼 수 있어요.':directOnly?'이 메시지는 관리자만 볼 수 있어요. 개인 전화번호는 표시되지 않아요.':'개인 전화번호는 표시되지 않아요. 같은 근무지 구성원이 이 대화를 함께 봅니다.'}</p></section>}
  </main>;
}
