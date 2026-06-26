'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ApplySheet } from '@/components/shifts/ApplySheet';

export type Shift = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  required_role: 'rn' | 'na' | 'any';
  hourly_wage: number;
  estimated_total_pay: number;
  description: string;
  department: string | null;
  notes: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  rn: '간호사 (RN)',
  na: '간호조무사 (NA)',
  any: '무관',
};

function ShiftCard({ shift, onApply }: { shift: Shift; onApply: () => void }) {
  const start = shift.start_time.slice(0, 5);
  const end = shift.end_time.slice(0, 5);
  const timeLabel = `${start} – ${end}${shift.is_overnight ? ' (익일)' : ''}`;
  const pay = shift.estimated_total_pay.toLocaleString('ko-KR');

  return (
    <div className="bg-white rounded-card shadow-card p-5 mb-3">
      {/* 날짜 + 자격 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-sub">{shift.shift_date}</span>
        <span className="text-[12px] font-bold text-primary bg-primary-light px-2.5 py-1 rounded-full">
          {ROLE_LABEL[shift.required_role]}
        </span>
      </div>

      {/* 시간 */}
      <p className="text-[22px] font-extrabold text-ink leading-tight mb-1">
        {timeLabel}
      </p>

      {/* 부서 / 설명 */}
      {shift.department && (
        <p className="text-[13px] text-tertiary mb-0.5">{shift.department}</p>
      )}
      <p className="text-[14px] text-sub line-clamp-2 mb-4">{shift.description}</p>

      {/* 야간 배지 */}
      {shift.is_overnight && (
        <span className="inline-flex items-center px-2.5 py-1 bg-kakao rounded-full text-[12px] font-bold text-ink mr-2 mb-3">
          🌙 야간수당 +50%
        </span>
      )}

      {/* 시급 / 예상 지급액 + 지원 버튼 */}
      <div className="flex items-center justify-between pt-4 border-t border-line">
        <div>
          <p className="text-[12px] text-tertiary">예상 지급액</p>
          <p className="text-[20px] font-extrabold text-ink">₩{pay}</p>
          <p className="text-[12px] text-tertiary">시급 {shift.hourly_wage.toLocaleString('ko-KR')}원</p>
        </div>
        <button
          onClick={onApply}
          className="h-12 px-6 bg-primary text-white text-[15px] font-bold rounded-btn shadow-btn active:opacity-80"
        >
          지원하기
        </button>
      </div>

      {/* 기타 안내 */}
      {shift.notes && (
        <p className="mt-3 text-[12px] text-tertiary border-t border-line pt-3">
          💡 {shift.notes}
        </p>
      )}
    </div>
  );
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Shift | null>(null);

  useEffect(() => {
    supabase
      .from('shifts')
      .select(
        'id, shift_date, start_time, end_time, is_overnight, required_role, hourly_wage, estimated_total_pay, description, department, notes'
      )
      .eq('status', 'open')
      .order('shift_date', { ascending: true })
      .order('start_time', { ascending: true })
      .then(({ data }) => {
        setShifts((data as Shift[]) ?? []);
        setLoading(false);
      });
  }, []);

  function handleApplied(shiftId: string) {
    setShifts((prev) => prev.filter((s) => s.id !== shiftId));
    setSelected(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-[15px] text-sub">시프트 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-10">
      {/* 헤더 */}
      <div className="pt-14 pb-6">
        <p className="text-[14px] text-sub mb-1">내 근처 모집 중인 시프트</p>
        <h1 className="text-[28px] font-extrabold text-ink leading-tight">
          시프트 {shifts.length}건
        </h1>
      </div>

      {shifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <span className="text-5xl">🔍</span>
          <p className="text-[17px] font-bold text-ink">근처 시프트가 없어요</p>
          <p className="text-[14px] text-sub text-center">
            새 공고가 올라오면<br />푸시 알림으로 알려드릴게요
          </p>
        </div>
      ) : (
        shifts.map((s) => (
          <ShiftCard key={s.id} shift={s} onApply={() => setSelected(s)} />
        ))
      )}

      {selected && (
        <ApplySheet
          shift={selected}
          onClose={() => setSelected(null)}
          onApplied={() => handleApplied(selected.id)}
        />
      )}
    </div>
  );
}
