'use client';

import { BRN_DOC_ACCEPT, formatBrnInput, validateBrnDocument } from '@/lib/brn-document-client';

// 사업자등록번호 + 등록증 파일 입력. 상태는 부모가 들고, 업로드는 부모가 사업장 id를 안 뒤에 한다.
export function BrnDocumentFields({ brn, file, onBrn, onFile, disabled, existingDocument, fileError }: {
  brn: string; file: File | null; onBrn: (v: string) => void; onFile: (f: File | null, error?: string) => void; disabled?: boolean; existingDocument?: boolean; fileError?: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="col-span-2 text-[12px] font-bold text-sub">사업자등록번호
        <input inputMode="numeric" value={brn} disabled={disabled} onChange={(e) => onBrn(formatBrnInput(e.target.value))} placeholder="000-00-00000" className="mt-1 h-11 w-full rounded-xl border border-line px-3 font-mono text-[15px] tracking-wider outline-none focus:border-primary disabled:bg-surface" />
      </label>
      <label className="col-span-2 text-[12px] font-bold text-sub">사업자등록증 사진 또는 PDF
        <input type="file" accept={BRN_DOC_ACCEPT} disabled={disabled} onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (!f) { onFile(null); return; }
          const err = validateBrnDocument(f);
          if (err) e.target.value = '';
          onFile(err ? null : f, err ?? undefined);
        }} className="mt-1 block w-full text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-2 file:text-[12px] file:font-bold file:text-primary" />
        {fileError ? <span role="alert" className="mt-1 block text-[11px] font-bold leading-4 text-warn">{fileError}</span>
          : <span className="mt-1 block text-[11px] font-medium leading-4 text-sub">
          {file ? `선택됨: ${file.name}` : existingDocument ? '이미 올린 서류가 있어요. 다시 올리면 교체돼요.' : '휴대폰으로 찍은 사진이면 충분해요. 잇닿 확인용으로만 쓰고 외부에 공개되지 않아요.'}
        </span>}
      </label>
    </div>
  );
}
