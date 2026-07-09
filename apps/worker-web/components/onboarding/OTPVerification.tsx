'use client';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export function OTPVerification({ onNext, submitting, submitError }: { onNext: () => void; submitting?: boolean; submitError?: string }) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const [timer, setTimer] = useState(47);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  useEffect(() => {
    if (timer <= 0) return;
    const t = setTimeout(() => setTimer((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timer]);

  function handleDigit(i: number, val: string) {
    const d = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    if (d && i < 3) refs[i + 1].current?.focus();
  }

  function handleKey(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs[i - 1].current?.focus();
  }

  const filled = digits.every((d) => d !== '');

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">인증 2/3</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">1원이 입금됐어요</h1>
      <p className="text-[15px] text-sub mb-2">입금자명에 보이는 4자리 숫자를 입력해주세요</p>

      {/* Account chip */}
      <div className="inline-flex items-center gap-2 bg-bg rounded-full px-4 py-2 mb-10 self-start">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3" width="14" height="10" rx="2" stroke="#4E5968" strokeWidth="1.4"/>
          <path d="M1 7h14" stroke="#4E5968" strokeWidth="1.4"/>
        </svg>
        <span className="text-[14px] font-medium text-sub">카카오뱅크 3333-12-****6789</span>
      </div>

      {/* 4-digit input */}
      <div className="flex gap-3 justify-center mb-8">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={refs[i]}
            type="tel"
            maxLength={1}
            value={d}
            onChange={(e) => handleDigit(i, e.target.value)}
            onKeyDown={(e) => handleKey(i, e)}
            className="w-[64px] h-[72px] rounded-card border-2 text-center text-[28px] font-bold text-ink outline-none transition-colors"
            style={{ borderColor: d ? '#3182F6' : '#E5E8EB' }}
          />
        ))}
      </div>

      {/* Resend */}
      <div className="text-center mb-10">
        <button className="text-[15px] font-semibold text-primary underline" onClick={() => setTimer(47)}>다시 보내기</button>
        <p className="text-[13px] text-tertiary mt-1">
          {timer > 0 ? `0:${String(timer).padStart(2, '0')} 후 재전송 가능` : '재전송 가능'}
        </p>
      </div>

      <div className="mt-auto">
        {submitError && (
          <p className="text-[13px] font-bold text-red-600 text-center mb-3">{submitError}</p>
        )}
        <Button onClick={onNext} disabled={!filled || submitting} variant={filled ? 'primary' : 'outline'}>
          {submitting ? '처리 중...' : '인증 완료'}
        </Button>
      </div>
    </div>
  );
}
