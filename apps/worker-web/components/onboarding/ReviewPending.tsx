'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

const STEPS = [
  { label: '카카오 로그인', done: true },
  { label: '역할·지역', done: true },
  { label: '면허·신분', done: true },
  { label: '계좌', done: true },
  { label: '서류 심사', done: false, active: true },
  { label: '승인 완료', done: false, active: false },
];

export function ReviewPending({ onHome }: { onHome: () => void }) {
  const [kakaoAlert, setKakaoAlert] = useState(true);

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      {/* Illustration */}
      <div className="flex flex-col items-center mb-8 mt-4">
        <div className="w-20 h-20 rounded-full bg-[#EBF3FF] flex items-center justify-center mb-6">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M20 8v6M20 26v6M8 20h6M26 20h6" stroke="#3182F6" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="20" cy="20" r="8" stroke="#3182F6" strokeWidth="2"/>
          </svg>
        </div>
        <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">심사 중이에요</h1>
        <p className="text-[15px] text-sub text-center">영업일 기준 1일 이내 알려드릴게요</p>
      </div>

      {/* Checklist */}
      <div className="bg-white rounded-card shadow-card p-5 mb-6">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-4 py-3 border-b border-line last:border-0">
            {s.done ? (
              <div className="w-6 h-6 rounded-full bg-success flex items-center justify-center flex-shrink-0">
                <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ) : s.active ? (
              <div className="w-6 h-6 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              </div>
            ) : (
              <div className="w-6 h-6 rounded-full bg-line flex-shrink-0" />
            )}
            <span className={`text-[16px] ${s.done ? 'text-success font-medium' : s.active ? 'text-primary font-semibold' : 'text-tertiary'}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Kakao alert toggle */}
      <div className="flex items-center justify-between bg-white rounded-card shadow-card px-5 py-4 mb-8">
        <div className="flex items-center gap-3">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M10 2C5.582 2 2 4.895 2 8.455c0 2.27 1.512 4.263 3.786 5.39l-.964 3.5a.25.25 0 00.38.273L9.58 15.1A9.18 9.18 0 0010 15.11c4.418 0 8-2.895 8-6.455S14.418 2 10 2z" fill="#191F28"/>
          </svg>
          <span className="text-[15px] font-medium text-ink">카카오톡 알림 받기</span>
        </div>
        <button
          onClick={() => setKakaoAlert(!kakaoAlert)}
          className={`w-12 h-7 rounded-full transition-colors ${kakaoAlert ? 'bg-primary' : 'bg-line'}`}
        >
          <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-1 ${kakaoAlert ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      <div className="mt-auto">
        <Button variant="outline" onClick={onHome}>홈으로</Button>
      </div>
    </div>
  );
}
