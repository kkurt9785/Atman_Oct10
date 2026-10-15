'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

type Props = { source: 'match' | 'workroom'; messageId: string; authorId: string | null; label: string; onChanged: (notice: string) => void };

export function MessageSafetyActions({ source, messageId, authorId, label, onChanged }: Props) {
  const [mode, setMode] = useState<'menu' | 'report' | 'block' | null>(null);
  const [reason, setReason] = useState('harassment');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (mode && !dialog.current?.open) dialog.current?.showModal();
    if (!mode && dialog.current?.open) dialog.current.close();
  }, [mode]);

  async function submit() {
    if (pending.current || !authorId) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      if (mode === 'report') {
        const { data, error: failure } = await supabase.rpc('report_safety_message', {
          p_source: source, p_message_id: messageId, p_reason: reason, p_note: note.trim(),
        });
        if (failure) throw new Error(failure.message);
        if (typeof data !== 'string') throw new Error('신고 접수 결과를 확인하지 못했어요.');
        onChanged('신고를 접수했어요. 운영자가 확인하며 상대방에게 신고자를 알리지 않아요.');
      } else if (mode === 'block') {
        const { data, error: failure } = await supabase.rpc('set_safety_user_block', { p_peer: authorId, p_blocked: true, p_label: label });
        if (failure) throw new Error(failure.message);
        if (data !== true) throw new Error('차단 결과를 확인하지 못했어요.');
        onChanged('사용자를 차단했어요. 내 정보의 차단 관리에서 해제할 수 있어요.');
      }
      setMode(null); setNote('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^.*?: /, '') : '처리하지 못했어요. 다시 시도해 주세요.');
    } finally { pending.current = false; setBusy(false); }
  }

  if (!authorId) return null;
  return <>
    <button type="button" aria-label={`${label} 메시지 신고·차단`} onClick={() => { setError(''); setMode('menu'); }}
      className="inline-flex min-h-11 items-center rounded-lg px-2 text-[12px] font-bold text-sub underline">신고·차단</button>
    <dialog ref={dialog} aria-labelledby={`safety-${messageId}`} onCancel={event => { if (busy) event.preventDefault(); else setMode(null); }} onClose={() => setMode(null)}
      className="m-auto w-[calc(100%_-_32px)] max-h-[90dvh] max-w-md overflow-y-auto rounded-2xl bg-white p-5 text-ink shadow-xl backdrop:bg-black/40">
      <h2 id={`safety-${messageId}`} className="text-[18px] font-extrabold">{mode === 'report' ? '메시지 신고' : mode === 'block' ? '사용자 차단' : '대화 안전 설정'}</h2>
      {mode === 'menu' ? <div className="mt-4 space-y-2">
        <button type="button" onClick={() => setMode('report')} className="min-h-12 w-full rounded-xl border border-line px-4 text-left text-[15px] font-bold">이 메시지 신고하기</button>
        <button type="button" onClick={() => setMode('block')} className="min-h-12 w-full rounded-xl border border-line px-4 text-left text-[15px] font-bold text-red-600">이 사용자 차단하기</button>
      </div> : mode === 'report' ? <div className="mt-4 space-y-3">
        <p className="text-[14px] leading-6 text-sub">선택한 메시지와 아래 내용을 운영자에게 전달해요. 비밀번호·계좌번호 등 민감한 정보는 추가로 적지 마세요.</p>
        <label className="block text-[14px] font-bold">신고 사유<select value={reason} onChange={event => setReason(event.target.value)} disabled={busy} className="mt-1 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-[16px]">
          <option value="harassment">욕설·괴롭힘·부적절한 내용</option><option value="spam">광고·스팸</option><option value="privacy">개인정보 침해</option><option value="other">기타</option>
        </select></label>
        <label className="block text-[14px] font-bold">추가 설명 (선택)<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} disabled={busy} rows={3} className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-[16px]" /></label>
      </div> : <p className="mt-4 text-[14px] leading-6 text-sub">{label}님의 대화와 채팅 알림을 숨기고 비공개 대화를 제한해요. 근태·급여 기록은 유지돼요. 차단은 내 정보에서 해제할 수 있어요.</p>}
      {error && <p role="alert" className="mt-3 text-[14px] font-bold text-red-600">{error}</p>}
      <div className="mt-5 flex gap-2">
        <button type="button" disabled={busy} onClick={() => setMode(null)} className="min-h-12 flex-1 rounded-xl bg-bg px-3 text-[15px] font-bold disabled:opacity-50">닫기</button>
        {mode !== 'menu' && <button type="button" disabled={busy} onClick={() => void submit()} className="min-h-12 flex-1 rounded-xl bg-primary px-3 text-[15px] font-bold text-white disabled:opacity-50">{busy ? '처리 중…' : mode === 'report' ? '신고 접수' : '차단하기'}</button>}
      </div>
    </dialog>
  </>;
}
