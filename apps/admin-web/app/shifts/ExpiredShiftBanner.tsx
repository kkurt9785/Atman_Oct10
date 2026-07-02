'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ShiftRow } from '@/lib/db/shifts';

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', any: '무관' };

function formatDate(dateStr: string) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}월 ${parseInt(d)}일`;
}

export function ExpiredShiftBanner({ shifts }: { shifts: ShiftRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || shifts.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-warn/30 bg-warn/8 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="text-xl flex-shrink-0">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className="text-body font-bold text-ink">
            매칭 못 된 시프트 {shifts.length}건
          </p>
          <p className="text-label text-sub">수정해서 다시 올릴까요?</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-label font-bold text-warn px-3 py-1.5 rounded-full bg-warn/15 active:opacity-70"
          >
            {expanded ? '접기' : '확인하기'}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="text-lg text-sub leading-none px-1 active:opacity-70"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
      </div>

      {/* 만료된 시프트 목록 */}
      {expanded && (
        <div className="border-t border-warn/20 divide-y divide-warn/10">
          {shifts.map((s) => (
            <div key={s.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-label text-sub">
                  {formatDate(s.shift_date)} · {ROLE_LABEL[s.required_role]}
                </p>
                <p className="text-body font-semibold text-ink truncate">{s.description}</p>
                <p className="text-label text-sub">
                  {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)} · {s.hourly_wage.toLocaleString('ko-KR')}원/시
                </p>
              </div>
              <Link
                href="/shifts/new"
                className="flex-shrink-0 text-label font-bold text-primary px-3 py-1.5 rounded-full bg-primary/10 active:opacity-70 whitespace-nowrap"
              >
                다시 올리기
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
