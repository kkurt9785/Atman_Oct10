'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Tile = { icon: string; label: string; href: string; badge?: number };

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

function Tile({ icon, label, href, badge }: Tile) {
  return (
    <Link
      href={href}
      className="relative flex flex-col items-center justify-center gap-2 bg-white rounded-2xl py-6 active:bg-bg"
    >
      {badge != null && badge > 0 && (
        <span className="absolute top-3 right-3 min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
      <span className="text-4xl">{icon}</span>
      <span className="text-body font-semibold text-ink">{label}</span>
    </Link>
  );
}
