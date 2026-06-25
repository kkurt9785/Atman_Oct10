'use client';
import { Button } from '@/components/ui/Button';

const METHODS = [
  {
    id: 'phone',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" stroke="#191F28" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: '휴대폰 인증',
    badge: true,
  },
  {
    id: 'card',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="5" width="20" height="14" rx="2" stroke="#191F28" strokeWidth="1.8"/>
        <path d="M2 10h20" stroke="#191F28" strokeWidth="1.8"/>
      </svg>
    ),
    label: '신용카드 인증',
    badge: false,
  },
  {
    id: 'cert',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M3 21V7l9-4 9 4v14" stroke="#191F28" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9 21v-6h6v6" stroke="#191F28" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
    label: '공동인증서',
    badge: false,
  },
];

export function IDVerification({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">인증</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">본인 확인이 필요해요</h1>
      <p className="text-[15px] text-sub mb-8">안전한 서비스를 위해 한 번만 인증하면 돼요</p>

      <div className="flex flex-col gap-3 flex-1">
        {METHODS.map((m) => (
          <button
            key={m.id}
            onClick={onNext}
            className="flex items-center gap-4 bg-white rounded-card px-5 py-4 shadow-card border border-line active:opacity-70 transition-opacity"
          >
            {m.icon}
            <span className="text-[17px] font-bold text-ink flex-1 text-left">{m.label}</span>
            {m.badge && (
              <span className="text-[12px] font-bold text-white bg-primary px-2.5 py-0.5 rounded-full">추천</span>
            )}
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
              <path d="M1 1l6 6-6 6" stroke="#8B95A1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ))}
      </div>

      <p className="text-center text-[12px] text-tertiary mt-6 flex items-center justify-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1a6 6 0 100 12A6 6 0 007 1zm0 8.5V7m0-2.5v.01" stroke="#8B95A1" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        정보는 암호화되어 안전하게 보관됩니다
      </p>
    </div>
  );
}
