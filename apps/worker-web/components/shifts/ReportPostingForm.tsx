'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

// 직업안정법 §25 — 허위·과장 공고 신고 창구. 운영자가 /ops/safety 에서 검토하고, 신고자 정보는 사업장에 전달하지 않는다.
// 사업장 시트와 지원 시트가 같이 쓴다(목록·지도에서 바로 지원하면 사업장 시트를 거치지 않는다).
const REPORT_REASONS: [string, string][] = [['false_ad', '허위·과장 광고'], ['wage_mismatch', '임금·근무 조건이 공고와 달라요'], ['contact_mismatch', '연락처·주소가 맞지 않아요'], ['identity', '사업장 신원이 의심돼요'], ['other', '기타']];

export function ReportPostingForm({ facilityId, shiftId = null }: { facilityId: string; shiftId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('false_ad');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (result) return <p role="status" className={`rounded-xl p-3 text-[13px] font-bold leading-5 ${result.ok ? 'bg-bg text-ink' : 'bg-amber-50 text-amber-800'}`}>{result.text}</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="min-h-11 text-[13px] font-bold text-sub underline">공고 내용이 사실과 다른가요? 신고하기</button>;
  return (
    <form className="space-y-3" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      try {
        const { error: rpcError } = await supabase.rpc('report_job_posting', { p_facility_id: facilityId, p_shift_id: shiftId, p_reason: reason, p_note: note.trim() });
        if (rpcError) setResult({ ok: false, text: rpcError.message || '신고를 접수하지 못했어요. 다시 시도해 주세요.' });
        else setResult({ ok: true, text: '신고가 접수됐어요. 운영자가 확인한 뒤 필요한 조치를 해요. 신고자 정보는 사업장에 전달하지 않아요.' });
      } catch {
        setResult({ ok: false, text: '연결을 확인하고 다시 시도해 주세요.' });
      } finally {
        setBusy(false);
      }
    }}>
      <p className="text-[13px] font-extrabold text-ink">무엇이 문제인가요?</p>
      <select value={reason} onChange={e => setReason(e.target.value)} disabled={busy} aria-label="신고 사유" className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-[14px]">
        {REPORT_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <textarea value={note} onChange={e => setNote(e.target.value)} disabled={busy} maxLength={1000} rows={3} placeholder="어떤 점이 공고와 달랐는지 적어 주세요 (선택)" aria-label="신고 내용" className="w-full rounded-xl border border-line p-3 text-[14px]" />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="min-h-12 flex-1 rounded-xl bg-primary text-[14px] font-bold text-white disabled:opacity-50">{busy ? '접수 중…' : '신고 접수'}</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-12 rounded-xl border border-line px-4 text-[14px] font-bold text-sub">취소</button>
      </div>
    </form>
  );
}
