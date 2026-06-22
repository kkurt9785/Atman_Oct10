import Link from 'next/link';
import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl p-5 ${className}`}>{children}</div>;
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
