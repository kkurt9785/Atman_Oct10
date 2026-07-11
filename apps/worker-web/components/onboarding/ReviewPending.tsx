'use client';

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
  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <div className="flex flex-col items-center mb-8 mt-4">
        <div className="w-20 h-20 rounded-full bg-[#EBF3FF] flex items-center justify-center mb-6">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M20 8v6M20 26v6M8 20h6M26 20h6" stroke="#3182F6" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="20" cy="20" r="8" stroke="#3182F6" strokeWidth="2" />
          </svg>
        </div>
        <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">심사 중이에요</h1>
        <p className="text-[15px] text-sub text-center">심사 결과는 앱 알림 설정에 따라 알려드려요.</p>
      </div>

      <div className="bg-white rounded-card shadow-card p-5 mb-6">
        {STEPS.map((step, index) => (
          <div key={step.label} className="flex items-center gap-4 py-3 border-b border-line last:border-0">
            {step.done ? (
              <div className="w-6 h-6 rounded-full bg-success flex items-center justify-center flex-shrink-0">
                <svg width="12" height="9" viewBox="0 0 12 9" fill="none" aria-hidden="true"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            ) : step.active ? (
              <div className="w-6 h-6 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0"><div className="w-2 h-2 rounded-full bg-primary animate-pulse" /></div>
            ) : (
              <div className="w-6 h-6 rounded-full bg-line flex-shrink-0" />
            )}
            <span className={`text-[16px] ${step.done ? 'text-success font-medium' : step.active ? 'text-primary font-semibold' : 'text-tertiary'}`}>
              {index + 1}. {step.label}
            </span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-card shadow-card px-5 py-4 mb-8">
        <p className="text-[15px] font-bold text-ink">알림은 설정 화면에서 관리해요</p>
        <p className="text-[13px] text-sub mt-1 break-keep">브라우저 알림 권한과 앱 푸시 구독 상태를 확인할 수 있어요. 카카오톡 알림은 현재 제공하지 않습니다.</p>
      </div>

      <div className="mt-auto"><Button variant="outline" onClick={onHome}>홈으로</Button></div>
    </div>
  );
}
