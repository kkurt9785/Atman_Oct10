'use client';

// 서버 컴포넌트/데이터 조회 실패의 전역 안전망 — 조용한 실패 대신 재시도 UI
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="px-4">
      <div className="mt-16 bg-white rounded-2xl p-8 text-center shadow-card">
        <p className="text-4xl mb-3">⚠️</p>
        <p className="text-body font-bold text-ink">화면을 불러오지 못했어요</p>
        <p className="text-label text-sub mt-2">네트워크 상태를 확인한 뒤 다시 시도해 주세요.</p>
        <button onClick={reset} className="mt-5 h-11 px-6 rounded-xl bg-primary text-white text-label font-bold">
          다시 시도
        </button>
      </div>
    </main>
  );
}
