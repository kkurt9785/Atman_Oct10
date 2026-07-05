'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createShiftAction } from '@/lib/actions/shifts';
import { calcEstimatedShiftPay, MIN_HOURLY_WAGE_2026 } from '@/lib/pay';
import { recommendedTierForShortfall, won } from '@/lib/billing';

type Role = 'rn' | 'na' | 'any';

const ROLES: { value: Role; label: string }[] = [
  { value: 'rn', label: '간호사 (RN)' },
  { value: 'na', label: '간호조무사 (NA)' },
  { value: 'any', label: '무관' },
];

export default function NewShiftPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [role, setRole] = useState<Role>('rn');
  const [shiftDate, setShiftDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [hourlyWage, setHourlyWage] = useState(15000);
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState('');
  const [notes, setNotes] = useState('');
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  const estimatedPay = calcEstimatedShiftPay(startTime, endTime, hourlyWage) ?? 0;
  const projectedBalance = creditBalance == null ? null : creditBalance - estimatedPay;
  const shortfall = projectedBalance == null ? 0 : Math.max(0, -projectedBalance);
  const recommendedTier = recommendedTierForShortfall(shortfall || estimatedPay || 500000);
  const isOvernight = startTime && endTime
    ? endTime <= startTime
    : false;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/summary')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && typeof data?.balance === 'number') setCreditBalance(data.balance);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  function handleStartTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setStartTime(val);
    // 종료 시각이 비어있으면 +8h 자동 제안
    if (val && !endTime) {
      const [h, m] = val.split(':').map(Number);
      const endH = (h + 8) % 24;
      setEndTime(`${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // 클라이언트 검증
    if (!shiftDate) { setError('날짜를 선택해주세요.'); return; }
    if (!startTime || !endTime) { setError('시작·종료 시간을 입력해주세요.'); return; }
    if (!description.trim()) { setError('업무 설명을 입력해주세요.'); return; }
    if (!hourlyWage || hourlyWage < MIN_HOURLY_WAGE_2026) { setError('시급은 최저시급(9,860원) 이상이어야 해요.'); return; }

    const formData = new FormData(e.currentTarget);
    formData.set('required_role', role);

    startTransition(async () => {
      try {
        await createShiftAction(formData);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (!msg.includes('NEXT_REDIRECT') && !msg.includes('digest')) {
          setError('등록 중 오류가 발생했어요. 다시 시도해주세요.');
        }
      }
    });
  }

  return (
    <main className="px-4 pb-32">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mt-2 mb-6 px-1">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-2xl text-sub leading-none"
          aria-label="뒤로"
        >
          ←
        </button>
        <h1 className="text-title font-extrabold text-ink">새 시프트 등록</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* 필요 자격 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-label font-bold text-sub mb-3">필요 자격 *</p>
          <div className="flex gap-2">
            {ROLES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setRole(value)}
                className={`flex-1 py-3 rounded-xl text-body font-bold transition-colors ${
                  role === value
                    ? 'bg-primary text-white'
                    : 'bg-bg text-sub'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* 일정 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-label font-bold text-sub mb-3">일정 *</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-label text-sub block mb-1">날짜</label>
              <input
                type="date"
                name="shift_date"
                required
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-label text-sub block mb-1">시작</label>
              <input
                type="time"
                name="start_time"
                required
                value={startTime}
                onChange={handleStartTimeChange}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-label text-sub block mb-1">
                종료{isOvernight && <span className="ml-1 text-warn"> · 익일</span>}
              </label>
              <input
                type="time"
                name="end_time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </section>

        {/* 임금 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-label font-bold text-sub mb-3">임금 *</p>
          <div>
            <label className="text-label text-sub block mb-1">시급</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-body text-sub">₩</span>
              <input
                type="number"
                name="hourly_wage"
                required
                step={1000}
                value={hourlyWage || ''}
                placeholder="15000"
                onChange={(e) => setHourlyWage(parseInt(e.target.value, 10) || 0)}
                className="w-full bg-bg rounded-xl pl-8 pr-4 py-3.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {hourlyWage > 0 && hourlyWage < MIN_HOURLY_WAGE_2026 && (
              <p className="text-label text-warn mt-1">2026년 최저시급(9,860원) 이상이어야 해요</p>
            )}
          </div>

          {estimatedPay > 0 && (
            <div className="mt-4 pt-4 border-t border-line">
              <div className="flex items-center justify-between">
                <p className="text-body text-sub">예상 총 지급액</p>
                <p className="text-money font-extrabold text-primary">{won(estimatedPay)}</p>
              </div>

              {creditBalance != null && (
                <div className="mt-4 bg-bg rounded-xl p-4">
                  <div className="flex justify-between text-label">
                    <span className="text-sub">현재 크레딧</span>
                    <span className="font-bold text-ink">{won(creditBalance)}</span>
                  </div>
                  <div className="flex justify-between text-label mt-2">
                    <span className="text-sub">매칭 시 예상 잔액</span>
                    <span className={`font-bold ${shortfall > 0 ? 'text-warn' : 'text-ink'}`}>
                      {projectedBalance != null && projectedBalance < 0 ? '-' : ''}{won(projectedBalance ?? 0)}
                    </span>
                  </div>
                  {shortfall > 0 && (
                    <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-3">
                      <p className="text-label text-warn font-bold">부족 예상 {won(shortfall)}</p>
                      <Link
                        href={`/membership?amount=${recommendedTier.charge}`}
                        className="h-9 px-3 rounded-lg bg-primary text-white text-label font-bold flex items-center"
                      >
                        충전
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 상세 정보 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-label font-bold text-sub mb-3">상세 정보</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-label text-sub block mb-1">업무 설명 *</label>
              <textarea
                name="description"
                required
                rows={3}
                placeholder="예: 3층 일반병동 야간 간호 지원, 투약 및 활력징후 측정"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink placeholder:text-sub resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-label text-sub block mb-1">부서 <span className="font-normal">(선택)</span></label>
              <input
                type="text"
                name="department"
                placeholder="예: 일반병동, 중환자실, 응급실"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink placeholder:text-sub focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-label text-sub block mb-1">기타 안내 <span className="font-normal">(선택)</span></label>
              <textarea
                name="notes"
                rows={2}
                placeholder="예: 식사 제공, 주차 가능, 복장 규정"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink placeholder:text-sub resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="bg-warn/10 rounded-xl px-4 py-3">
            <p className="text-body text-warn font-bold">{error}</p>
          </div>
        )}

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={isPending || estimatedPay === 0}
          className="flex items-center justify-center min-h-tap rounded-xl bg-primary text-white text-body font-bold w-full disabled:opacity-50 active:opacity-90 transition-opacity"
        >
          {isPending ? '등록 중...' : '시프트 등록하기'}
        </button>
      </form>
    </main>
  );
}
