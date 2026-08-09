'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export type QuickMenuIcon = 'recruit'|'clock'|'staff'|'leave'|'qr'|'repeat'|'alert'|'chat'|'pay'|'bill'|'settings'|'applications';
type Tile = { icon: QuickMenuIcon; label: string; description?: string; href: string; badge?: number };

const PATHS: Record<QuickMenuIcon, React.ReactNode> = {
  recruit:<><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 12h8M12 9v6"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  staff:<><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 8h5M18.5 5.5v5"/></>,
  leave:<><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3"/></>,
  qr:<><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-6v-2"/></>,
  repeat:<><path d="M4 8a7 7 0 0 1 12-3l2 2M20 16a7 7 0 0 1-12 3l-2-2M18 3v4h-4M6 21v-4h4"/></>,
  alert:<><path d="M12 3 2.8 19h18.4zM12 9v4M12 17h.01"/></>,
  chat:<><path d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5"/></>,
  pay:<><path d="M5 5h14v14H5zM8 9h8M8 13h8M12 7v8"/></>,
  bill:<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/></>,
  settings:<><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 9 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A7 7 0 0 0 10.4 18l.3 2.6h4L15 18a7 7 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z"/></>,
  applications:<><path d="M7 3h10v4H7zM5 5H3v16h18V5h-2M8 12h8M8 16h5"/></>,
};

function MenuIcon({name}:{name:QuickMenuIcon}){
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>;
}

// 자주 쓰는 4개는 항상 크게, 나머지는 접어서(펼침 상태 기억) 노출.
export function QuickMenu({ primary, more }: { primary: Tile[]; more: Tile[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(localStorage.getItem('home_more_open') === '1');
  }, []);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      localStorage.setItem('home_more_open', next ? '1' : '0');
      return next;
    });
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {primary.map((t) => (
          <Tile key={t.href} {...t} />
        ))}
      </div>

      <button
        onClick={toggle}
        aria-expanded={open}
        className="mt-3 w-full h-11 rounded-xl bg-white text-sub text-label font-bold flex items-center justify-center gap-1 active:bg-bg"
      >
        전체 메뉴 {open ? '접기 ▴' : '더보기 ▾'}
      </button>

      {open && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          {more.map((t) => (
            <Tile key={t.href} {...t} />
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ icon, label, description, href, badge }: Tile) {
  return (
    <Link
      href={href}
      className="relative flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl bg-white px-3 py-5 text-center active:bg-bg"
    >
      {badge != null && badge > 0 && (
        <span className="absolute top-3 right-3 min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
      <MenuIcon name={icon}/>
      <span className="text-body font-semibold text-ink">{label}</span>
      {description && <span className="text-[11px] leading-4 text-sub">{description}</span>}
    </Link>
  );
}
