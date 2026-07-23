'use client';

import { Button } from '@/components/ui/Button';

export function Approval({ onStart, onBrowse }: { onStart: () => void; onBrowse: () => void }) {
  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <div className="flex flex-col items-center mb-8 mt-4">
        <div className="w-24 h-24 rounded-full bg-success-light flex items-center justify-center mb-6">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <path d="M10 24L20 34L38 14" stroke="#00C896" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-[28px] font-bold text-ink letter-tight mb-2 text-center">가입 준비가 완료됐어요</h1>
        <p className="text-[16px] text-sub text-center break-keep">내 활동 지역의 시프트를 확인하고 지원할 수 있어요.</p>
      </div>

      <div className="bg-white rounded-card shadow-card p-5 mb-6">
        <p className="text-[17px] font-bold text-ink mb-3">시작하기 전에 확인해 주세요</p>
        <ul className="space-y-3 text-[14px] text-sub">
          <li className="flex gap-2"><span aria-hidden="true">✓</span><span>면허 서류 상태는 병원이 지원자를 검토할 때 참고할 수 있어요.</span></li>
          <li className="flex gap-2"><span aria-hidden="true">✓</span><span>근무 전 시프트 시간, 위치, 급여 조건을 다시 확인해 주세요.</span></li>
          <li className="flex gap-2"><span aria-hidden="true">✓</span><span>출퇴근 QR은 근무 당일 발급되며 60초 동안 한 번만 사용할 수 있어요.</span></li>
        </ul>
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <Button onClick={onStart}>내 근처 시프트 보기</Button>
        <button onClick={onBrowse} className="text-[15px] font-medium text-sub text-center py-2">홈으로 이동</button>
      </div>
    </div>
  );
}
