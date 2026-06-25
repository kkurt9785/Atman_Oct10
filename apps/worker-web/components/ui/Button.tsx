'use client';
import Link from 'next/link';

type Props = {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: 'primary' | 'kakao' | 'outline' | 'ghost';
  disabled?: boolean;
  className?: string;
};

export function Button({ children, onClick, href, variant = 'primary', disabled, className = '' }: Props) {
  const base = 'w-full h-14 flex items-center justify-center rounded-btn text-[17px] font-semibold transition-opacity active:opacity-80 select-none';
  const variants = {
    primary: 'bg-primary text-white shadow-btn',
    kakao: 'bg-kakao text-[#191F28] gap-2',
    outline: 'border-2 border-line text-ink bg-white',
    ghost: 'text-sub text-[15px] font-medium',
  };
  const cls = `${base} ${variants[variant]} ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button onClick={onClick} disabled={disabled} className={cls}>{children}</button>;
}
