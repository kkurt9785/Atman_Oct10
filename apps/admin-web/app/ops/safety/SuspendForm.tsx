'use client';
import { useRef, useState } from 'react';
import { setFacilityPostingSuspension } from './actions';
// 공고 게재 중지/해제 — 중지는 사유를 받고 한 번 더 확인한다(사업장의 모든 공고가 목록에서 내려간다)
export function SuspendForm({ facilityId, suspendedAt, suspendedReason }: { facilityId: string; suspendedAt: string | null; suspendedReason: string | null }) {
  const [reason, setReason] = useState(''), [arming, setArming] = useState(false), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const lock = useRef(false);
  async function run(suspend: boolean) {
    if (lock.current) return; lock.current = true; setBusy(true); setFeedback('');
    try { const result = await setFacilityPostingSuspension(facilityId, suspend, reason); setFeedback(result.error ?? (suspend ? '게재를 중지했어요. 이 사업장 공고가 목록에서 내려가요.' : '게재 중지를 해제했어요.')); if (!result.error) setArming(false); }
    catch { setFeedback('저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  }
  if (suspendedAt) return <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
    <p className="font-bold text-amber-800">게재 중지 중 · {new Date(suspendedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}{suspendedReason ? ` · ${suspendedReason}` : ''}</p>
    <button type="button" disabled={busy} onClick={() => run(false)} className="mt-2 min-h-11 rounded-xl border border-line bg-white px-4 font-bold disabled:opacity-50">{busy ? '처리 중…' : '게재 중지 해제'}</button>
    {feedback && <p role="status" className="mt-2">{feedback}</p>}
  </div>;
  return <div className="mt-3 rounded-xl border border-line p-3 text-sm">
    <label className="block font-bold">허위로 확인되면 게재 중지<input value={reason} onChange={e => setReason(e.target.value)} disabled={busy} maxLength={300} placeholder="중지 사유 (예: 실제 사업장과 다른 상호로 공고)" className="mt-1 min-h-11 w-full rounded-xl border p-3 text-base font-normal" /></label>
    {!arming
      ? <button type="button" disabled={busy || !reason.trim()} onClick={() => setArming(true)} className="mt-2 min-h-11 rounded-xl border border-red-200 px-4 font-bold text-red-600 disabled:opacity-40">게재 중지</button>
      : <span className="mt-2 inline-flex flex-wrap items-center gap-2"><span className="font-bold text-red-600">이 사업장의 모든 공고가 목록에서 내려가고 새 공고를 올릴 수 없어요.</span>
          <button type="button" disabled={busy} onClick={() => run(true)} className="min-h-11 rounded-xl bg-red-600 px-4 font-bold text-white disabled:opacity-50">{busy ? '처리 중…' : '중지 확정'}</button>
          <button type="button" disabled={busy} onClick={() => setArming(false)} className="min-h-11 rounded-xl border border-line px-4 font-bold">닫기</button></span>}
    {feedback && <p role="status" className="mt-2">{feedback}</p>}
  </div>;
}
