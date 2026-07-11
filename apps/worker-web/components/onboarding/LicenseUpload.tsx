'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BYTES = 10 * 1024 * 1024;

export function validateLicenseFile(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) return 'JPG, PNG, WEBP 또는 HEIC 파일만 등록할 수 있어요.';
  if (file.size > MAX_BYTES) return '파일 크기는 10MB 이하여야 해요.';
  if (file.size === 0) return '빈 파일은 등록할 수 없어요.';
  return null;
}

export function LicenseUpload({ onNext, onSkip }: { onNext: (file: File) => void; onSkip: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(next: File | undefined) {
    if (!next) return;
    const validation = validateLicenseFile(next);
    setError(validation ?? '');
    setFile(validation ? null : next);
  }

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">단계 3 / 정보 입력</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">면허증을 등록할게요</h1>
      <p className="text-[15px] text-sub mb-8">사진은 비공개 저장소에 보관되고 심사 담당자에게만 제한적으로 표시돼요.</p>

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
      <button type="button" onClick={() => inputRef.current?.click()} className="w-full rounded-[20px] border-2 border-dashed border-primary bg-primary-light flex flex-col items-center justify-center gap-3 mb-3 transition-opacity active:opacity-70" style={{ height: 200 }}>
        {file ? <p className="text-[15px] font-medium text-primary px-4 text-center break-all">{file.name}</p> : <><span className="text-4xl">📋</span><span className="text-[16px] font-semibold text-primary">사진을 올려주세요</span></>}
      </button>
      <p className="text-[13px] text-tertiary text-center mb-2">JPG · PNG · WEBP · HEIC, 10MB 이내</p>
      {error && <p role="alert" className="text-[13px] text-red-600 font-bold text-center mb-6">{error}</p>}

      <div className="mt-auto flex flex-col gap-3">
        <Button onClick={() => file && onNext(file)} disabled={!file}>등록하기</Button>
        <Button variant="ghost" onClick={onSkip}>나중에 등록할게요</Button>
      </div>
    </div>
  );
}
