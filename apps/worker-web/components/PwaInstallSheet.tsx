'use client';

const STEPS = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 3v13M8 8l4-4 4 4" stroke="#3182F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" stroke="#3182F6" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    text: '사파리 하단 공유 버튼(↑) 탭',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="4" stroke="#3182F6" strokeWidth="2"/>
        <path d="M12 8v8M8 12h8" stroke="#3182F6" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    text: '"홈 화면에 추가" 선택',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="#3182F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    text: '오른쪽 상단 "추가" 탭',
  },
  {
    icon: <span className="text-2xl">🏠</span>,
    text: '홈 화면 잇닿 아이콘으로 앱 열기',
  },
];

export function PwaInstallSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-[24px] p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 핸들 */}
        <div className="w-10 h-1 bg-line rounded-full mx-auto mb-5" />

        <h3 className="text-[20px] font-extrabold text-ink mb-1">알림 받는 방법</h3>
        <p className="text-[14px] text-sub mb-6">
          iPhone에서 알림을 받으려면 앱을 홈 화면에 추가해야 해요
        </p>

        <div className="flex flex-col gap-4 mb-7">
          {STEPS.map((step, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                {step.icon}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-primary bg-primary/10 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <p className="text-[15px] font-medium text-ink">{step.text}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full py-4 bg-primary text-white text-[16px] font-bold rounded-2xl active:opacity-80"
        >
          확인했어요
        </button>
      </div>
    </div>
  );
}
