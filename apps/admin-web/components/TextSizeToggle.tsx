'use client';
import { useEffect, useState } from 'react';

// 토스식 "큰글씨" 토글 — root font-size를 키워 글씨·아이콘 전체를 ×1.25 확대
export function TextSizeToggle() {
  const [big, setBig] = useState(false);
  useEffect(() => { setBig(document.documentElement.classList.contains('big-text')); }, []);

  function toggle() {
    const next = !big;
    document.documentElement.classList.toggle('big-text', next);
    try { localStorage.setItem('bigText', next ? '1' : '0'); } catch {}
    setBig(next);
  }

  return (
    <button onClick={toggle} aria-pressed={big} aria-label="큰글씨 모드"
      title={big ? '기본 글씨로 보기' : '큰 글씨로 보기'}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold transition
        ${big ? 'bg-primary text-white' : 'bg-white text-sub'}`}>
      <span className="text-[14px] leading-none">{big ? '가−' : '가+'}</span>
    </button>
  );
}
