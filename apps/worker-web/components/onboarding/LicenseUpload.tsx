'use client';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';

export function LicenseUpload({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">단계 3 / 정보 입력</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">면허증을 등록할게요</h1>
      <p className="text-[15px] text-sub mb-8">안전한 간호 서비스를 위해 면허증 확인이 필요해요</p>

      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />

      <button
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-[20px] border-2 border-dashed border-primary bg-primary-light flex flex-col items-center justify-center gap-3 mb-3 transition-opacity active:opacity-70"
        style={{ height: 200 }}
      >
        {file ? (
          <p className="text-[15px] font-medium text-primary px-4 text-center break-all">{file.name}</p>
        ) : (
          <>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <path d="M28 26a2 2 0 01-2 2H14a2 2 0 01-2-2V18a2 2 0 012-2h2l2-3h4l2 3h2a2 2 0 012 2v8z" stroke="#3182F6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="20" cy="22" r="3" stroke="#3182F6" strokeWidth="1.8" fill="none"/>
            </svg>
            <span className="text-[16px] font-semibold text-primary">사진을 올려주세요</span>
          </>
        )}
      </button>
      <p className="text-[13px] text-tertiary text-center mb-10">JPG · PNG · HEIC, 10MB 이내</p>

      <div className="mt-auto flex flex-col gap-3">
        <Button onClick={onNext}>등록하기</Button>
        <Button variant="ghost" onClick={onSkip}>나중에 등록할게요</Button>
      </div>
    </div>
  );
}
