'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { WorkerRole } from '@/lib/roles';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;

export function validateLicenseFile(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) return 'JPG, PNG, WEBP, HEIC 또는 PDF 파일만 등록할 수 있어요.';
  if (file.size > MAX_BYTES) return '파일 크기는 10MB 이하여야 해요.';
  if (file.size === 0) return '빈 파일은 등록할 수 없어요.';
  return null;
}

export type LicensePayload = { file: File | null; number: string };

// 직군별 서류 분기: 약사=면허 필수(사진/번호) · 약국 전산·사무직=이력서 필수(파일) · 간호직=면허 권장(건너뛰기 가능)
export function LicenseUpload({ role, onNext, onSkip }: { role?: WorkerRole | null; onNext: (payload: LicensePayload) => void; onSkip: () => void }) {
  const isResume = role === 'pharmacy_staff';
  const required = isResume; // 약국 사무·전산직 이력서만 필수. 면허는 사업장이 채용 확정 전 확인
  const [mode, setMode] = useState<'photo' | 'text'>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(next: File | undefined) {
    if (!next) return;
    const validation = validateLicenseFile(next);
    setError(validation ?? '');
    setFile(validation ? null : next);
  }

  const canSubmit = mode === 'photo' || isResume ? Boolean(file) : number.trim().length >= 4;

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">서류 등록 / 정보 입력</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">{isResume ? '이력서를 등록할게요' : '면허·자격을 등록할게요'}</h1>
      <p className="text-[15px] text-sub mb-6">
        {isResume
          ? '약국 담당자가 지원자를 확인할 때 참고하는 자료예요. PDF 또는 사진으로 올려주세요. 비공개로 보관됩니다.'
          : required
            ? '약사 공고 지원에는 면허 확인이 필요해요. 사진 또는 면허 번호로 등록해 주세요. 비공개로 보관됩니다.'
            : '사진 또는 면허 번호 중 편한 방법으로 등록하세요. 정보는 비공개로 보관되고 지원한 사업장 담당자에게만 제한적으로 표시돼요.'}
      </p>

      {/* 사진 / 번호 입력 토글 — 이력서(전산·사무직)는 파일 업로드만 */}
      {!isResume && (
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            type="button"
            onClick={() => { setMode('photo'); setError(''); }}
            className={`h-11 rounded-xl text-[14px] font-bold transition-colors ${mode === 'photo' ? 'bg-primary text-white' : 'bg-primary-light text-primary'}`}
          >
            📷 사진으로 등록
          </button>
          <button
            type="button"
            onClick={() => { setMode('text'); setError(''); }}
            className={`h-11 rounded-xl text-[14px] font-bold transition-colors ${mode === 'text' ? 'bg-primary text-white' : 'bg-primary-light text-primary'}`}
          >
            🔢 번호로 입력
          </button>
        </div>
      )}

      {mode === 'photo' || isResume ? (
        <>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} className="w-full rounded-[20px] border-2 border-dashed border-primary bg-primary-light flex flex-col items-center justify-center gap-3 mb-3 transition-opacity active:opacity-70" style={{ height: 200 }}>
            {file ? <p className="text-[15px] font-medium text-primary px-4 text-center break-all">{file.name}</p> : <><span className="text-4xl">📋</span><span className="text-[16px] font-semibold text-primary">{isResume ? '이력서 파일을 올려주세요' : '사진을 올려주세요'}</span></>}
          </button>
          <p className="text-[13px] text-tertiary text-center mb-2">{isResume ? 'PDF · JPG · PNG, 10MB 이내' : 'JPG · PNG · WEBP · HEIC · PDF, 10MB 이내'}</p>
        </>
      ) : (
        <>
          <input
            type="text"
            inputMode="text"
            value={number}
            onChange={(e) => { setNumber(e.target.value); setError(''); }}
            placeholder="면허·자격 번호 입력 (예: 제12345호)"
            className="w-full h-14 rounded-[16px] border border-line bg-white px-4 text-[16px] outline-none focus:border-primary mb-3"
          />
          <p className="text-[13px] text-tertiary text-center mb-2">면허증에 기재된 번호를 그대로 입력해 주세요</p>
        </>
      )}
      {error && <p role="alert" className="text-[13px] text-red-600 font-bold text-center mb-6">{error}</p>}

      <div className="mt-auto flex flex-col gap-3">
        <Button
          onClick={() => canSubmit && onNext({ file: mode === 'photo' || isResume ? file : null, number: mode === 'text' && !isResume ? number.trim() : '' })}
          disabled={!canSubmit}
        >
          등록하기
        </Button>
        {required
          ? <p className="text-[12px] text-tertiary text-center">{isResume ? '이력서를 등록해야 다음 단계로 넘어갈 수 있어요' : '약사 지원에는 면허 등록이 필요해요'}</p>
          : <Button variant="ghost" onClick={onSkip}>나중에 등록할게요</Button>}
      </div>
    </div>
  );
}
