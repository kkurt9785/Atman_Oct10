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
type CheckStatusRow = { check_id: string; staff_id: string; staff_name: string; replied_at: string | null };

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function dueLabel(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

// 사업장 워크룸(관리자). 공지·대화·출퇴근 기록에 더해 '출석 확인'을 올리고 누가 답했는지 본다 — 단체톡 출석체크의 앱 버전.
export function WorkroomClient({ facilityId, facilityName, memberCount }: { facilityId: string; facilityName: string; memberCount: number }) {
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
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    const { data } = await supabase.rpc('get_workroom_check_status', { p_facility_id: facilityId });
    const grouped: Record<string, CheckStatusRow[]> = {};
    for (const row of (data ?? []) as CheckStatusRow[]) (grouped[row.check_id] ??= []).push(row);
    setCheckStatus(grouped);
  }, [facilityId]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase.from('facility_workroom_messages')
      .select('id,facility_id,sender_type,sender_user_id,sender_name,message_type,body,metadata,created_at')
      .eq('facility_id', facilityId).order('created_at', { ascending: true }).limit(200);
    if (loadError) setError('워크룸을 불러오지 못했어요. 데이터베이스 업데이트 상태를 확인해 주세요.');
    else {
      setMessages((data ?? []) as Message[]);
      await Promise.all([supabase.rpc('mark_facility_workroom_read', { p_facility_id: facilityId }), loadStatus()]);
    }
    setLoading(false);
  }, [facilityId, loadStatus]);

  useEffect(() => {
    void load();
    const channel = supabase.channel(`workroom-admin-${facilityId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'facility_workroom_messages', filter: `facility_id=eq.${facilityId}` }, (payload) => {
        const row = payload.new as Message;
        setMessages((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
        void supabase.rpc('mark_facility_workroom_read', { p_facility_id: facilityId });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'facility_workroom_check_replies' }, () => { void loadStatus(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [facilityId, load, loadStatus]);

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

  async function createCheck() {
    const body = checkBody.trim();
    if (!body || sending) return;
    setSending(true); setError('');
    const { error: checkError } = await supabase.rpc('create_workroom_check', {
      p_facility_id: facilityId, p_body: body, p_due_at: checkDue ? new Date(checkDue).toISOString() : null,
    });
    setSending(false);
    if (checkError) { setError(checkError.message.replace(/^.*?: /, '')); return; }
    setCheckOpen(false); setCheckDue('');
    await loadStatus();
    fetch('/api/chat/nudge', { method: 'POST' }).catch(() => undefined);
  }

  return <main className="flex min-h-[calc(100dvh-8.5rem)] flex-col px-4 pb-4">
    <header className="mb-3 rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em]">WORKROOM</span><span className="text-[12px] font-bold text-white/65">연결 {memberCount}명</span></div>
      <h1 className="mt-4 text-[25px] font-extrabold">{facilityName}</h1>
      <p className="mt-1 text-[12px] leading-5 text-white/65">전화번호 대신 여기서 공지하고, 출석 확인과 출퇴근 기록을 함께 봐요.</p>
    </header>

    <section className="min-h-[360px] flex-1 overflow-y-auto rounded-2xl bg-white px-4 py-4 shadow-sm">
      {loading && <p className="py-16 text-center text-[13px] text-sub">워크룸 기록을 불러오고 있어요...</p>}
      {!loading && messages.length === 0 && <div className="py-16 text-center"><p className="text-[15px] font-bold text-ink">첫 공지를 남겨보세요</p><p className="mt-1 text-[12px] text-sub">가입한 워커의 앱과 푸시 알림으로 전달돼요.</p></div>}
      <div className="flex flex-col gap-3">
        {messages.map((message) => {
          if (message.sender_type === 'system') return <div key={message.id} className={`rounded-2xl px-4 py-3 text-[12px] leading-5 ${message.message_type === 'attendance' ? 'border border-primary/15 bg-primary/5 text-ink' : 'bg-bg text-sub'}`}><p className="font-bold text-primary">{message.sender_name}</p><p>{message.body}</p><time className="mt-1 block text-[10px] text-tertiary">{timeLabel(message.created_at)}</time></div>;
          const isCheck = message.metadata?.kind === 'check' && typeof message.metadata?.checkId === 'string';
          if (isCheck) {
            const rows = checkStatus[message.metadata.checkId as string] ?? [];
            const replied = rows.filter((row) => row.replied_at);
            const pending = rows.filter((row) => !row.replied_at);
            const due = dueLabel(message.metadata.dueAt);
            return <div key={message.id} className="self-stretch rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3">
              <div className="flex items-center justify-between"><span className="text-[11px] font-extrabold tracking-[0.1em] text-primary">출석 확인</span><time className="text-[10px] text-tertiary">{timeLabel(message.created_at)}</time></div>
              <p className="mt-1 whitespace-pre-wrap text-[14px] font-bold leading-5 text-ink">{message.body}</p>
              {due && <p className="mt-1 text-[11px] text-sub">기한 {due}</p>}
              <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2">
                <span className="text-[13px] font-extrabold text-ink">확인 {replied.length}/{rows.length}</span>
                <span className="text-[11px] text-sub">{rows.length === 0 ? '연결된 근무자 없음' : pending.length === 0 ? '모두 확인했어요' : `미확인 ${pending.length}명`}</span>
              </div>
              {replied.length > 0 && <p className="mt-2 text-[11px] leading-4 text-sub"><b className="text-emerald-600">확인</b> · {replied.map((row) => row.staff_name).join(', ')}</p>}
              {pending.length > 0 && <p className="mt-1 text-[11px] leading-4 text-sub"><b className="text-amber-600">미확인</b> · {pending.map((row) => row.staff_name).join(', ')}</p>}
            </div>;
          }
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
      {checkOpen ? (
        <div className="mb-3 rounded-xl bg-primary/5 p-3">
          <p className="text-[12px] font-extrabold text-primary">출석 확인 요청</p>
          <textarea value={checkBody} onChange={(event)=>setCheckBody(event.target.value)} maxLength={500} rows={2} className="mt-2 w-full resize-none rounded-xl border border-line bg-white px-3 py-2 text-[14px] text-ink outline-none"/>
          <label className="mt-2 block text-[11px] font-bold text-sub">답변 기한 <span className="font-normal">· 선택</span><input type="datetime-local" value={checkDue} onChange={(event)=>setCheckDue(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-[13px]"/></label>
          <div className="mt-2 flex gap-2"><button type="button" onClick={()=>setCheckOpen(false)} className="h-10 flex-1 rounded-xl bg-white text-[13px] font-bold text-sub">취소</button><button type="button" onClick={()=>void createCheck()} disabled={sending||!checkBody.trim()} className="h-10 flex-1 rounded-xl bg-primary text-[13px] font-extrabold text-white disabled:opacity-40">근무자에게 보내기</button></div>
        </div>
      ) : (
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[12px] font-bold text-sub"><input type="checkbox" checked={announcement} onChange={(event)=>setAnnouncement(event.target.checked)} className="h-4 w-4 accent-primary"/>전체 공지로 강조하기</label>
          <button type="button" onClick={()=>setCheckOpen(true)} className="h-8 rounded-lg bg-ink px-3 text-[12px] font-extrabold text-white">✓ 출석 확인 요청</button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea value={input} onChange={(event)=>setInput(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}} maxLength={2000} rows={2} placeholder="공지나 전달사항을 입력하세요" className="min-h-[48px] flex-1 resize-none rounded-xl bg-bg px-3 py-3 text-[14px] text-ink outline-none"/>
        <button type="button" onClick={()=>void send()} disabled={!input.trim()||sending} className="h-12 rounded-xl bg-primary px-4 text-[13px] font-extrabold text-white disabled:opacity-40">전송</button>
      </div>
    </section>
  </main>;
}
