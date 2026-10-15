'use client';
import { useRef, useState } from 'react';
import { reviewSafetyReport } from './actions';
export function ReviewForm({ id, initialStatus, initialNote }: { id:string; initialStatus:string; initialNote:string|null }) {
  const [status,setStatus]=useState(initialStatus==='open'?'reviewing':initialStatus);
  const [note,setNote]=useState(initialNote??''),[hide,setHide]=useState(false),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState('');
  const lock=useRef(false);
  return <form className="mt-4 space-y-3" onSubmit={async event=>{
    event.preventDefault(); if(lock.current)return;lock.current=true;setBusy(true);setFeedback('');
    try{const result=await reviewSafetyReport(id,status,note,hide);setFeedback(result.error??'검토 결과를 저장했어요.');}
    catch{setFeedback('저장하지 못했어요. 다시 시도해 주세요.');}
    finally{lock.current=false;setBusy(false);}
  }}>
    <label className="block text-sm font-bold">검토 상태<select disabled={busy} value={status} onChange={e=>{setStatus(e.target.value);setHide(false);}} className="mt-1 min-h-12 w-full rounded-xl border p-3 text-base"><option value="reviewing">검토 중</option><option value="resolved">조치 완료</option><option value="dismissed">위반 아님</option></select></label>
    <label className="block text-sm font-bold">처리 기록<textarea disabled={busy} value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} rows={3} className="mt-1 w-full rounded-xl border p-3 text-base"/></label>
    {status==='resolved'&&<label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hide} disabled={busy} onChange={e=>setHide(e.target.checked)}/>위반 메시지를 안내 문구로 대체 (원문은 신고 기록에 보관)</label>}
    <button disabled={busy} className="min-h-12 rounded-xl bg-primary px-5 font-bold text-white disabled:opacity-50">{busy?'저장 중…':'검토 결과 저장'}</button>
    {feedback&&<p role="status" className="text-sm">{feedback}</p>}
  </form>;
}
