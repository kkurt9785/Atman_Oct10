'use client';
import { Button } from '@/components/ui/Button';

export function Approval({ onStart, onBrowse }: { onStart: () => void; onBrowse: () => void }) {
  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      {/* Success animation */}
      <div className="flex flex-col items-center mb-8 mt-4">
        <div className="w-24 h-24 rounded-full bg-success-light flex items-center justify-center mb-6">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path d="M10 24L20 34L38 14" stroke="#00C896" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 className="text-[28px] font-bold text-ink letter-tight mb-2 text-center">환영해요, 김간호님!</h1>
        <p className="text-[16px] text-sub text-center">내 근처 시프트 8건이 기다리고 있어요</p>
      </div>

      {/* Recommended shift card */}
      <div className="bg-white rounded-card shadow-card p-5 mb-6">
        {/* Hospital */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-[#EBF3FF] flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M3 21V7l8-5 8 5v14" stroke="#3182F6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 21v-6h6v6" stroke="#3182F6" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="M11 9v4M9 11h4" stroke="#3182F6" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="text-[17px] font-bold text-ink leading-tight">서울대학교병원 간호간병통합</p>
            <p className="text-[13px] text-tertiary mt-0.5">내 위치에서 2.3km</p>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { icon: '📅', label: '6월 5일(목)' },
            { icon: '🌙', label: '22:00–06:00' },
            { icon: '💰', label: '₩152,000' },
          ].map((m) => (
            <div key={m.label} className="flex flex-col items-center gap-1 bg-bg rounded-xl py-3">
              <span className="text-[18px]">{m.icon}</span>
              <span className="text-[12px] font-medium text-sub text-center">{m.label}</span>
            </div>
          ))}
        </div>

        {/* Night badge */}
        <div className="inline-flex items-center px-3 py-1 bg-kakao rounded-full mb-1">
          <span className="text-[13px] font-bold text-ink">야간수당 +50%</span>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <Button onClick={onStart}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="mr-2">
            <path d="M9 2v7l5 3" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="9" cy="9" r="7" stroke="white" strokeWidth="2"/>
          </svg>
          바로 지원하기
        </Button>
        <button onClick={onBrowse} className="text-[15px] font-medium text-sub text-center py-2">
          다른 시프트 둘러보기
        </button>
      </div>
    </div>
  );
}
