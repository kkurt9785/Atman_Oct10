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
      className={`flex items-center gap-1.5 px-3 py-2 rounded-full font-bold transition
        ${big ? 'bg-primary text-white' : 'bg-bg text-sub'}`}>
      <span className="text-title leading-none">가</span>
      <span className="text-label">{big ? '큰글씨 켬' : '큰글씨'}</span>
    </button>
  );
}
