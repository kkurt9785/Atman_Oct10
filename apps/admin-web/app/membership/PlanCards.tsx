'use client';
import { useState } from 'react';
import { won } from '@/lib/format';

// 결제 주기 선택 + 할인가 표시 (2026-08-05 정책: 6개월 5% · 1년 10% 선결제)
// 실결제는 청구서 기반 — 여기서는 금액 안내까지만 담당한다.

export type PlanCardData = {
  code: string; name: string; monthly_fee: number;
  features: Record<string, unknown>;
};

type Cycle = 'monthly' | 'semiannual' | 'annual';
const CYCLES: { key: Cycle; label: string; months: number; discount: number }[] = [
  { key: 'monthly', label: '월간', months: 1, discount: 0 },
  { key: 'semiannual', label: '6개월 · 5% 할인', months: 6, discount: 0.05 },
  { key: 'annual', label: '1년 · 10% 할인', months: 12, discount: 0.10 },
];

const UNLIMITED = 999999;
const cap = (n: number) => (n >= UNLIMITED ? '무제한' : `${n}`);

const PLAN_PERKS: Record<string, string[]> = {
  free: ['공고 월 1건', '직원 근태 3명', '관리자 1명', '기본 자격 확인·채팅'],
  clinic: ['직원 최대 10명', '간편 출퇴근·휴가', '공고 월 3건', '함께한 근무자 5명 재요청'],
  pharmacy: ['약사·전산직 최대 5명', '간편 출퇴근·휴가·급여 검토', '공고 월 3건', '추가 공고 1건 9,900원(VAT 포함)', '함께한 약사 반복근무 요청', '옵션: 관리자 1명 추가 +월 20,000원'],
  pharmacy_plus: ['약사·전산직 최대 10명', '공고 월 10건 · 반복요청 10명', '추가 공고 1건 9,900원(VAT 포함)', '반복 일정 자동화(토요일 대체약사 등)', '관리자 3명 · 자격 만료관리'],
  basic: ['직원 근태 20명', '공고 월 10건', '월 반복요청 대상 20명', '관리자 2명'],
  pro: ['직원 근태 30명', '공고 월 20건', '월 반복요청 대상 30명', '관리자 3명 · 자격·운영 자동화'],
  enterprise: ['직원 근태 50명', '공고 무제한 · 반복요청 50명', '관리자 5명', '한 사업장 자격·운영 통합관리'],
};

type PlanExtras = { included_job_posting_slots?: number; included_active_workers?: number; included_admin_seats?: number };

export function PlanCards({ plans, currentPlanCode }: { plans: (PlanCardData & PlanExtras)[]; currentPlanCode?: string | null }) {
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const meta = CYCLES.find((c) => c.key === cycle)!;

  return (
    <>
      <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-2xl bg-white p-1.5 shadow-card" role="group" aria-label="결제 주기 선택">
        {CYCLES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCycle(c.key)}
            aria-pressed={cycle === c.key}
            className={`h-10 rounded-xl text-[12px] font-bold ${cycle === c.key ? 'bg-primary text-white' : 'bg-bg text-sub'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {cycle !== 'monthly' && (
        <div className="mb-3 rounded-xl bg-primary/5 border border-primary/15 px-3 py-2.5">
          <p className="text-[11px] leading-4 text-sub">
            {meta.months}개월 선결제 · 부가세 별도 · 중도해지 시 이용 개월은 할인 전 정상가로 정산 후 잔액 환불
          </p>
          <a href="#invoices" className="mt-1 inline-block text-[12px] font-bold text-primary">전환을 원하시면 다음 청구서에 반영을 요청하세요 →</a>
        </div>
      )}
      <div className="space-y-3 mb-4">
        {plans.map((plan) => {
          const isCurrent = currentPlanCode === plan.code;
          const popular = plan.features?.popular === true;
          const perks =
            PLAN_PERKS[plan.code] ??
            [`공고 ${cap(plan.included_job_posting_slots ?? 0)}건`, `인력풀 ${cap(plan.included_active_workers ?? 0)}명`, `관리자 ${plan.included_admin_seats ?? 1}명`];
          // 이용 중인 플랜은 실제 청구 기준가(월간)를 고정 표시 — 할인가를 얹으면 현재 결제액이 바뀐 것처럼 읽힌다
          const discountable = cycle !== 'monthly' && !isCurrent && plan.monthly_fee > 0 && plan.code !== 'enterprise' && Boolean((plan.features as any)?.cycle_discounts);
          const total = discountable ? Math.round(plan.monthly_fee * meta.months * (1 - meta.discount)) : plan.monthly_fee;
          const perMonth = discountable ? Math.round(total / meta.months) : plan.monthly_fee;
          const savings = discountable ? plan.monthly_fee * meta.months - total : 0;
          return (
            <article key={plan.code} className={`bg-white rounded-2xl p-5 ${popular ? 'ring-2 ring-primary shadow-lg' : 'shadow-card'} ${isCurrent ? 'ring-2 ring-success' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-title font-extrabold">{plan.name}</p>
                  {popular && <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-primary text-white">★ 인기</span>}
                  {isCurrent && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success">이용 중</span>}
                </div>
                <div className="text-right flex-shrink-0">
                  {plan.monthly_fee === 0 ? (
                    <p className="text-[22px] font-extrabold text-ink leading-none">무료</p>
                  ) : discountable ? (
                    <>
                      <p className="text-[22px] font-extrabold text-ink leading-none">{won(perMonth)}<span className="text-[12px] font-bold text-sub"> /월</span></p>
                      <p className="text-[11px] text-tertiary mt-0.5">{meta.months === 12 ? '연' : `${meta.months}개월`} {won(total)} 선결제</p>
                      <p className="text-[11px] font-bold text-primary mt-0.5">월간 대비 {won(savings)} 절약</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[22px] font-extrabold text-ink leading-none">{won(plan.monthly_fee)}</p>
                      <p className="text-[11px] text-tertiary mt-0.5">월 · 부가세 별도</p>
                    </>
                  )}
                </div>
              </div>
              {typeof plan.features?.tagline === 'string' && <p className="text-[13px] text-sub mt-1.5">{plan.features.tagline as string}</p>}
              <ul className="mt-3 space-y-1.5">
                {perks.map((perk, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px] text-ink"><span className={popular ? 'text-primary' : 'text-sub'}>✓</span>{perk}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </>
  );
}
