'use client';

import { useState, useTransition } from 'react';
import { BrnDocumentFields } from '@/components/BrnDocumentFields';
import { uploadBrnDocument } from '@/lib/brn-document-client';
import { submitFacilityBrnDocument } from '@/lib/facility';

// 승인 대기 사업장만: 사업자등록번호·등록증을 뒤늦게 올리거나 교체
const STATUS_LABEL: Record<string, string> = { active: '계속사업자로 확인됐어요 ✓', suspended: '휴업 사업자로 조회됐어요', closed: '폐업 사업자로 조회됐어요', unknown: '국세청에 등록되지 않은 번호로 조회됐어요' };

export function BrnDocumentSection({ facilityId, brnSubmitted, hasDocument, businessStatus, businessStatusDetail }: { facilityId: string; brnSubmitted: string | null; hasDocument: boolean; businessStatus?: string | null; businessStatusDetail?: string | null }) {
  const [brn, setBrn] = useState(brnSubmitted ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [uploaded, setUploaded] = useState(hasDocument);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setMessage(null);
    startTransition(async () => {
      try {
        const documentPath = file ? await uploadBrnDocument(file, facilityId) : null;
        const r = await submitFacilityBrnDocument({ facilityId, brn, documentPath });
        if (!r.ok) { setMessage({ kind: 'error', text: r.error ?? '제출하지 못했어요.' }); return; }
        if (documentPath) setUploaded(true);
        setFile(null);
        setMessage({ kind: 'ok', text: '제출됐어요 ✓ 잇닿이 확인하면 공고 등록이 열려요.' });
      } catch (err) { setMessage({ kind: 'error', text: err instanceof Error ? err.message : '제출하지 못했어요.' }); }
    });
  }

  return (
    <form id="brn-document" onSubmit={submit} className="scroll-mt-20 px-4 pt-5">
      {businessStatus && <p className={`mb-3 rounded-xl px-3 py-2 text-[0.75rem] font-bold ${businessStatus === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>국세청 조회 · {STATUS_LABEL[businessStatus] ?? businessStatus}{businessStatusDetail ? ` (${businessStatusDetail})` : ''}{businessStatus !== 'active' ? ' — 번호가 맞는지 확인하고 다시 제출해 주세요.' : ''}</p>}
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-[0.8125rem] font-bold text-amber-800">사업자 확인 · 승인 대기 중</p>
        <p className="mb-4 mt-1 text-[0.75rem] leading-5 text-amber-700">사업자등록번호와 등록증을 올려 주시면 확인이 빨라져요. {uploaded ? '등록증은 이미 받았어요.' : ''}</p>
        <div className="rounded-xl bg-white p-4">
          <BrnDocumentFields brn={brn} file={file} onBrn={setBrn} onFile={(f, err) => { setFile(f); setMessage(err ? { kind: 'error', text: err } : null); }} disabled={isPending} existingDocument={uploaded} />
        </div>
        {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={`mt-3 text-[0.8125rem] font-bold ${message.kind === 'ok' ? 'text-success' : 'text-warn'}`}>{message.text}</p>}
        <button type="submit" disabled={isPending || (brn.replace(/\D/g, '').length !== 10 && !file)} className="mt-4 h-12 w-full rounded-xl bg-amber-600 text-[0.875rem] font-bold text-white disabled:opacity-50">{isPending ? '올리는 중...' : '제출하기'}</button>
      </section>
    </form>
  );
}
