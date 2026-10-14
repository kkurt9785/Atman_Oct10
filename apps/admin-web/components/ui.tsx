import Link from 'next/link';
import type { ReactNode } from 'react';

// 기본 배경·패딩은 className에 같은 속성이 없을 때만 넣는다.
// (같이 넣으면 Tailwind CSS 순서상 bg-white·p-5가 이겨서 bg-primary·bg-amber-50·p-0 등이 무시됐다)
const HAS_BG = /(^|\s)bg-/;
const HAS_PADDING = /(^|\s)p-\d/;
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  const bg = HAS_BG.test(className) ? '' : 'bg-white ';
  const pad = HAS_PADDING.test(className) ? '' : 'p-5 ';
  return <div className={`${bg}${pad}rounded-2xl ${className}`}>{children}</div>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-title font-bold text-ink mt-7 mb-3 px-1">{children}</h2>;
}

/** 큰 숫자 강조 (금액·시간) */
export function BigStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-label text-sub mb-1">{label}</p>
      <p className="text-money font-extrabold text-ink">{value}</p>
      {sub && <p className="text-label text-sub mt-1">{sub}</p>}
    </div>
  );
}

/** 크고 명확한 기본 버튼 (최소 56px) */
export function PrimaryButton({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link href={href}
      className="flex items-center justify-center min-h-tap rounded-xl bg-primary text-white text-body font-bold w-full active:opacity-90">
      {children}
    </Link>
  );
}

/** 큰 아이콘 + 라벨 바로가기 (한 화면 한 동작) */
export function ActionTile({ icon, label, href }: { icon: string; label: string; href: string }) {
  return (
    <Link href={href}
      className="flex flex-col items-center justify-center gap-2 bg-white rounded-2xl py-6 active:bg-bg">
      <span className="text-4xl">{icon}</span>
      <span className="text-body font-semibold text-ink">{label}</span>
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    '근무중': 'bg-success/15 text-success',
    '퇴근': 'bg-line text-sub',
    '예정': 'bg-primary/10 text-primary',
    '결근': 'bg-warn/15 text-warn',
  };
  return <span className={`text-label font-bold px-3 py-1 rounded-full ${map[status] ?? 'bg-line text-sub'}`}>{status}</span>;
}
