'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function ActivityArea({ onNext }: { onNext: () => void }) {
  const [radius, setRadius] = useState(5);

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">단계 2 / 정보 입력</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-6">어디서 일하실래요?</h1>

      {/* Map placeholder */}
      <div className="w-full rounded-card overflow-hidden bg-[#E8EDF2] flex-shrink-0 mb-5 flex flex-col items-center justify-center gap-2" style={{ height: '56vw', maxHeight: 240 }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <path d="M18 3C12.477 3 8 7.477 8 13c0 8.25 10 20 10 20s10-11.75 10-20c0-5.523-4.477-10-10-10zm0 13.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" fill="#8B95A1"/>
        </svg>
        <span className="text-[13px] text-tertiary">카카오맵</span>
      </div>

      {/* Current location */}
      <div className="flex items-center gap-2 mb-6">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="3" fill="#3182F6"/>
          <circle cx="8" cy="8" r="7" stroke="#3182F6" strokeWidth="1.5" fill="none"/>
        </svg>
        <span className="text-[15px] text-ink font-medium">현재 위치: 강남구 역삼동</span>
      </div>

      {/* Radius slider */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[15px] font-medium text-ink">활동 반경</span>
          <span className="text-[13px] font-semibold text-primary bg-primary-light px-3 py-1 rounded-full">반경 {radius}km</span>
        </div>
        <input
          type="range" min={1} max={20} value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
        />
        <div className="flex justify-between mt-1.5">
          <span className="text-[12px] text-tertiary">1km</span>
          <span className="text-[12px] text-tertiary">20km</span>
        </div>
      </div>

      <Button onClick={onNext}>다음 단계</Button>
    </div>
  );
}
