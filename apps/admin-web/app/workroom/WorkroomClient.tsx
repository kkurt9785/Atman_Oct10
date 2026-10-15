'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageSafetyActions } from '@/components/safety/MessageSafetyActions';
import { loadWorkroomPage, type WorkroomMessage as Message } from '@/lib/workroom-messages';
import { supabase } from '@/lib/supabase-browser';

type CheckStatusRow = { check_id: string; staff_id: string; staff_name: string; replied_at: string | null };
type Member = { id: string; name: string; workerLinked: boolean };

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value));
}
function dueLabel(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

// 사업장 워크룸(관리자). 공지·대화·출퇴근 기록에 더해 '출석 확인'을 올리고 누가 답했는지 본다 — 단체톡 출석체크의 앱 버전.
export function WorkroomClient({ facilityId, facilityName, members, initialStaffId }: { facilityId: string; facilityName: string; members: Member[]; initialStaffId: string }) {
  const [selectedStaffId, setSelectedStaffId] = useState(initialStaffId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [announcement, setAnnouncement] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkBody, setCheckBody] = useState('내일 출근 확인해 주세요. 확인 버튼을 눌러 주세요.');
  const [checkDue, setCheckDue] = useState('');
  const [checkStatus, setCheckStatus] = useState<Record<string, CheckStatusRow[]>>({});
  const [userId, setUserId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [notice, setNotice] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const sendLock = useRef(false), olderLock = useRef(false), sequence = useRef(0);
  const currentRoom = useRef(selectedStaffId), rowsRef = useRef(messages);
  const drafts = useRef(new Map<string,string>());
  currentRoom.current = selectedStaffId; rowsRef.current = messages;
  useEffect(() => {
    setInput(drafts.current.get(selectedStaffId) ?? ''); setError(''); setNotice('');
    setCheckOpen(false); setAnnouncement(false);
  }, [selectedStaffId]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedMember=members.find((member)=>member.id===selectedStaffId)??null;
  const linkedCount=members.filter((member)=>member.workerLinked).length;

  const loadStatus = useCallback(async () => {
    try {
      const { data, error: failure } = await supabase.rpc('get_workroom_check_status', { p_facility_id: facilityId });
      if (failure || !Array.isArray(data)) throw new Error();
      const grouped: Record<string, CheckStatusRow[]> = {};
      for (const row of data as CheckStatusRow[]) (grouped[row.check_id] ??= []).push(row);
      setCheckStatus(grouped); setStatusError('');
    } catch { setStatusError('출석 응답 현황을 불러오지 못했어요.'); }
  }, [facilityId]);

  const load = useCallback(async (older = false) => {
    if (older && (olderLock.current || !rowsRef.current[0])) return;
    const request = older ? sequence.current : ++sequence.current;
    const cursor = older ? rowsRef.current[0] : undefined;
    if (older) { olderLock.current = true; setLoadingOlder(true); }
    else { setLoading(true); setMessages([]); setHasMore(false); }
    setLoadError('');
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('로그인한 뒤 대화를 다시 열어 주세요.');
      const page = await loadWorkroomPage(supabase, { facilityId, staffId: selectedStaffId || null, includeGroup: false }, cursor);
      if (request !== sequence.current) return;
      setUserId(user.id);
      setMessages(current => [...new Map([...current, ...page.messages].map(row => [row.id,row])).values()]
        .sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at) || a.id.localeCompare(b.id)));
      setHasMore(page.hasMore);
      void Promise.all([
        selectedStaffId ? supabase.rpc('mark_staff_workroom_read',{p_staff_id:selectedStaffId}) : supabase.rpc('mark_facility_workroom_read',{p_facility_id:facilityId}),
        loadStatus(),
      ]).catch(() => undefined);
    } catch (caught) {
      if (request === sequence.current) setLoadError(caught instanceof Error ? caught.message : '대화를 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (request === sequence.current) setLoading(false);
      if (older) { olderLock.current = false; setLoadingOlder(false); }
    }
  }, [facilityId, loadStatus, selectedStaffId]);

  useEffect(() => {
    let active = true;
    void load();
    const channel = supabase.channel(`workroom-admin-${facilityId}-${selectedStaffId || 'group'}`)
      .on('postgres_changes', {event:'INSERT',schema:'public',table:'facility_workroom_messages',filter:`facility_id=eq.${facilityId}`}, payload => {
        if (!active) return;
        const row = payload.new as Message;
        if (selectedStaffId ? row.staff_id !== selectedStaffId : row.staff_id !== null) return;
        setMessages(current => current.some(item => item.id===row.id) ? current : [...current,row]);
      })
      .on('postgres_changes', {event:'INSERT',schema:'public',table:'facility_workroom_check_replies'}, () => { if (active) void loadStatus(); })
      .subscribe();
    return () => { active = false; sequence.current++; void supabase.removeChannel(channel); };
  }, [facilityId, selectedStaffId, load, loadStatus]);

  const newestId = messages.at(-1)?.id;
  useEffect(() => { if (newestId) bottomRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'}); }, [newestId]);

  async function send() {
    const draft = input, body = draft.trim(), room = selectedStaffId;
    if (!body || sendLock.current || loading || loadError) return;
    sendLock.current = true; setSending(true); setError('');
    try {
      const { data, error: failure } = room
        ? await supabase.rpc('send_staff_workroom_message',{p_staff_id:room,p_body:body})
        : await supabase.rpc('send_facility_workroom_message',{p_facility_id:facilityId,p_body:body,p_announcement:announcement});
      if (failure) throw new Error(failure.message);
      if (!data || typeof data.id !== 'string') throw new Error('전송 결과를 확인하지 못했어요. 대화를 다시 불러와 확인해 주세요.');
      if (drafts.current.get(room) === draft) drafts.current.delete(room);
      if (currentRoom.current === room) {
        setInput(current => current===draft ? '' : current); setAnnouncement(false);
        setMessages(current => current.some(item => item.id===data.id) ? current : [...current,data as Message]);
      }
      void fetch('/api/chat/nudge',{method:'POST'}).catch(() => undefined);
    } catch (caught) {
      if (currentRoom.current===room) setError(caught instanceof Error ? caught.message : '전송하지 못했어요. 작성한 내용은 유지돼요.');
    } finally { sendLock.current=false; setSending(false); }
  }

  async function createCheck() {
    const body = checkBody.trim(), room = selectedStaffId;
    if (!body || sendLock.current || loading || loadError) return;
    sendLock.current=true; setSending(true); setError('');
    try {
      const date = checkDue ? new Date(checkDue + ':00+09:00') : null;
      if (date && (!Number.isFinite(date.getTime()) || date.getTime()<=Date.now())) throw new Error('답변 기한은 현재 이후의 한국 시간으로 선택해 주세요.');
      const due = date?.toISOString() ?? null;
      const { error: failure } = room
        ? await supabase.rpc('create_staff_workroom_checks',{p_facility_id:facilityId,p_staff_ids:[room],p_body:body,p_due_at:due})
        : await supabase.rpc('create_workroom_check',{p_facility_id:facilityId,p_body:body,p_due_at:due});
      if (failure) throw new Error(failure.message);
      if (currentRoom.current===room) { setCheckOpen(false); setCheckDue(''); setNotice('출석 확인 요청을 보냈어요.'); void load(); }
      void fetch('/api/chat/nudge',{method:'POST'}).catch(() => undefined);
    } catch (caught) {
      if (currentRoom.current===room) setError(caught instanceof Error ? caught.message : '요청을 보내지 못했어요. 다시 시도해 주세요.');
    } finally { sendLock.current=false; setSending(false); }
  }

  return <main className="mx-auto flex min-h-[calc(100dvh-8.5rem)] w-full max-w-3xl flex-col px-4 pb-4">
    <header className="mb-3 rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-white/15 px-2.5 py-1 text-[0.6875rem] font-extrabold">워크룸</span><span className="text-[0.75rem] font-bold text-white/65">연결 {linkedCount}명</span></div>
      <h1 className="mt-4 text-[1.5625rem] font-extrabold">{facilityName}</h1>
      <p className="mt-1 text-[0.75rem] leading-5 text-white/65">전체 공지와 근무자별 비공개 대화를 나눠 관리해요.</p>
    </header>

    <Link href="/safety" className="mb-2 inline-flex min-h-11 items-center self-end text-[14px] font-bold text-sub underline">대화 안전·차단 관리</Link>
    {notice && <p role="status" className="mb-3 rounded-xl bg-primary/5 p-3 text-[14px] text-primary">{notice}</p>}
    <div className="-mx-4 mb-3 overflow-x-auto px-4 pt-3 [scrollbar-width:none]">
      <div className="flex w-max gap-2">
        <button type="button" onClick={()=>setSelectedStaffId('')} className={`h-10 rounded-full px-4 text-[0.75rem] font-extrabold ${!selectedStaffId?'bg-primary text-white':'border border-line bg-white text-sub'}`}>전체 공지</button>
        {members.map((member)=><button key={member.id} type="button" disabled={!member.workerLinked} onClick={()=>setSelectedStaffId(member.id)} className={`h-10 rounded-full px-4 text-[0.75rem] font-extrabold ${selectedStaffId===member.id?'bg-ink text-white':member.workerLinked?'border border-line bg-white text-sub':'border border-line bg-bg text-tertiary opacity-50'}`}>{member.name}{!member.workerLinked?' · 초대 전':''}</button>)}
      </div>
    </div>

    <section className="min-h-[360px] flex-1 overflow-y-auto rounded-2xl bg-white px-4 py-4 shadow-sm">
      {loading && <p className="py-16 text-center text-[0.8125rem] text-sub">워크룸 기록을 불러오고 있어요...</p>}
      {loadError && <div role="alert" className="py-4 text-[14px] text-red-600"><p>{loadError}</p><button type="button" onClick={() => void load()} className="mt-2 min-h-11 rounded-xl bg-bg px-4 font-bold">다시 불러오기</button></div>}
      {statusError && <div role="alert" className="py-2 text-[14px] text-red-600">{statusError}<button type="button" onClick={() => void loadStatus()} className="ml-2 min-h-11 underline">응답 현황 재시도</button></div>}
      {hasMore && !loading && <button type="button" disabled={loadingOlder} onClick={() => void load(true)} className="mb-3 min-h-11 w-full rounded-xl bg-bg text-[14px] font-bold text-primary">{loadingOlder ? '불러오는 중…' : '이전 대화 더 보기'}</button>}
      {!loading && !loadError && messages.length === 0 && <div className="py-16 text-center"><p className="text-[0.9375rem] font-bold text-ink">{selectedMember?`${selectedMember.name}님과 첫 대화를 시작하세요`:'첫 공지를 남겨보세요'}</p><p className="mt-1 text-[0.75rem] text-sub">{selectedMember?'이 대화는 해당 근무자와 관리자만 볼 수 있어요.':'가입한 모든 근무자의 앱과 알림으로 전달돼요.'}</p></div>}
      <div className="flex flex-col gap-3">
        {messages.map((message) => {
          if (message.sender_type === 'system') return <div key={message.id} className={`rounded-2xl px-4 py-3 text-[0.75rem] leading-5 ${message.message_type === 'attendance' ? 'border border-primary/15 bg-primary/5 text-ink' : 'bg-bg text-sub'}`}><p className="font-bold text-primary">{message.sender_name}</p><p>{message.body}</p><time className="mt-1 block text-[0.6875rem] text-tertiary">{timeLabel(message.created_at)}</time></div>;
          const isCheck = message.metadata?.kind === 'check' && typeof message.metadata?.checkId === 'string';
          if (isCheck) {
            const rows = checkStatus[message.metadata.checkId as string] ?? [];
            const replied = rows.filter((row) => row.replied_at);
            const pending = rows.filter((row) => !row.replied_at);
            const due = dueLabel(message.metadata.dueAt);
            return <div key={message.id} className="self-stretch rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3">
              <div className="flex items-center justify-between"><span className="text-[0.6875rem] font-extrabold tracking-[0.1em] text-primary">출석 확인</span><time className="text-[0.6875rem] text-tertiary">{timeLabel(message.created_at)}</time></div>
              <p className="mt-1 whitespace-pre-wrap text-[0.875rem] font-bold leading-5 text-ink">{message.body}</p>
              {due && <p className="mt-1 text-[0.6875rem] text-sub">기한 {due}</p>}
              <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2">
                <span className="text-[0.8125rem] font-extrabold text-ink">{statusError ? '현황 확인 필요' : `확인 ${replied.length}/${rows.length}`}</span>
                <span className="text-[0.6875rem] text-sub">{statusError ? '다시 불러와 주세요' : rows.length === 0 ? '연결된 근무자 없음' : pending.length === 0 ? '모두 확인했어요' : `미확인 ${pending.length}명`}</span>
              </div>
              {replied.length > 0 && <p className="mt-2 text-[0.6875rem] leading-4 text-sub"><b className="text-emerald-600">확인</b> · {replied.map((row) => row.staff_name).join(', ')}</p>}
              {pending.length > 0 && <p className="mt-1 text-[0.6875rem] leading-4 text-sub"><b className="text-amber-600">미확인</b> · {pending.map((row) => row.staff_name).join(', ')}</p>}
            </div>;
          }
          const mine = message.sender_user_id === userId;
          const notice = message.message_type === 'announcement';
          return <div key={message.id} className={`max-w-[86%] ${mine ? 'self-end' : 'self-start'}`}>
            <p className={`mb-1 text-[0.6875rem] font-bold ${mine ? 'text-right text-primary' : 'text-sub'}`}>{notice ? '공지 · ' : ''}{message.sender_name}</p>
            <div className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-4 py-3 text-[0.875rem] leading-5 ${notice ? 'border border-amber-200 bg-amber-50 text-ink' : mine ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md border border-line bg-white text-ink'}`}>{message.body}</div>
            <time className={`mt-1 block text-[0.6875rem] text-tertiary ${mine ? 'text-right' : ''}`}>{timeLabel(message.created_at)}</time>
            {!mine && <MessageSafetyActions source="workroom" messageId={message.id} authorId={message.sender_user_id} label={message.sender_name} onChanged={value => { setNotice(value); void load(); }} />}
          </div>;
        })}
      </div>
      <div ref={bottomRef}/>
    </section>

    <section className="sticky bottom-[calc(64px+var(--demo-bar,0px)+env(safe-area-inset-bottom))] mt-3 rounded-2xl border border-line bg-white p-3 shadow-card">
      {error && <p role="alert" className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-[0.75rem] font-bold text-red-600">{error}</p>}
      {checkOpen ? (
        <div className="mb-3 rounded-xl bg-primary/5 p-3">
          <p className="text-[0.75rem] font-extrabold text-primary">출석 확인 요청</p>
          <textarea aria-label="출석 확인 요청 내용" disabled={sending} value={checkBody} onChange={(event)=>setCheckBody(event.target.value)} maxLength={500} rows={2} className="mt-2 w-full resize-none rounded-xl border border-line bg-white px-3 py-2 text-[16px] text-ink outline-none"/>
          <label className="mt-2 block text-[0.6875rem] font-bold text-sub">답변 기한 (한국 시간) <span className="font-normal">· 선택</span><input type="datetime-local" disabled={sending} value={checkDue} onChange={(event)=>setCheckDue(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-[0.8125rem]"/></label>
          <div className="mt-2 flex gap-2"><button type="button" disabled={sending} onClick={()=>setCheckOpen(false)} className="h-10 flex-1 rounded-xl bg-white text-[0.8125rem] font-bold text-sub">취소</button><button type="button" onClick={()=>void createCheck()} disabled={sending||loading||!!loadError||!checkBody.trim()} className="h-10 flex-1 rounded-xl bg-primary text-[0.8125rem] font-extrabold text-white disabled:opacity-40">근무자에게 보내기</button></div>
        </div>
      ) : (
        <div className="mb-2 flex items-center justify-between gap-2">
          {selectedMember?<p className="text-[0.75rem] font-bold text-sub">{selectedMember.name}님만 보는 비공개 대화</p>:<label className="flex items-center gap-2 text-[0.75rem] font-bold text-sub"><input type="checkbox" checked={announcement} onChange={(event)=>setAnnouncement(event.target.checked)} className="h-4 w-4 accent-primary"/>전체 공지로 강조하기</label>}
          <button type="button" disabled={sending||loading||!!loadError} onClick={()=>setCheckOpen(true)} className="h-8 rounded-lg bg-ink px-3 text-[0.75rem] font-extrabold text-white">✓ 출석 확인 요청</button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea aria-label="워크룸 메시지" disabled={loading||!!loadError} value={input} onChange={(event)=>{setInput(event.target.value);drafts.current.set(selectedStaffId,event.target.value);}} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}} maxLength={2000} rows={2} placeholder={selectedMember?`${selectedMember.name}님에게 메시지`:'전체 공지나 전달사항'} className="min-h-[48px] min-w-0 flex-1 resize-none rounded-xl bg-bg px-3 py-3 text-[0.875rem] text-ink outline-none"/>
        <button type="button" onClick={()=>void send()} disabled={!input.trim()||sending||loading||!!loadError} className="h-12 rounded-xl bg-primary px-4 text-[0.8125rem] font-extrabold text-white disabled:opacity-40">전송</button>
      </div>
    </section>
  </main>;
}
