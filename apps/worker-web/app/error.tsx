'use client';

// 전역 에러 안전망 — 조용한 실패 대신 재시도 UI
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-col items-center justify-center min-h-[70vh] px-8 text-center">
      <p className="text-4xl mb-3">⚠️</p>
      <p className="text-[17px] font-bold text-ink">화면을 불러오지 못했어요</p>
      <p className="text-[14px] text-sub mt-2">네트워크 상태를 확인한 뒤 다시 시도해 주세요.</p>
      <button onClick={reset} className="mt-6 h-12 px-8 rounded-xl bg-primary text-white text-[15px] font-bold">
        다시 시도
      </button>
    </main>
  );
}
