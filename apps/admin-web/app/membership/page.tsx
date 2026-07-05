import { adminClient } from '@/lib/supabase';
import { getCurrentFacilityId } from '@/lib/facility';
import CreditChargePanel from './CreditChargePanel';
import { getBillingSummary } from '@/lib/db/billing';
import { recommendedTierForShortfall } from '@/lib/billing';

type LedgerRow = {
  id: string;
  delta: number;
  kind: string;
  ref: string | null;
  created_at: string;
};

const KIND_LABEL: Record<string, string> = {
  charge:     '크레딧 충전',
  earn:       '크레딧 충전',
  shift_wage: '시프트 임금',
  spend:      '시프트 임금',
  bonus:      '보너스 크레딧',
  refund:     '환불',
};

function won(n: number) {
  return '₩' + Math.abs(n).toLocaleString('ko-KR');
}

async function getLedger(): Promise<{ balance: number; rows: LedgerRow[] }> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return { balance: 0, rows: [] };

  const [ledgerRes, creditRes] = await Promise.all([
    sb
      .from('credit_ledger')
      .select('id, delta, kind, ref, created_at')
      .eq('org_id', facilityId)
      .order('created_at', { ascending: false })
      .limit(30),
    sb.rpc('org_credit_balance', { p_org_id: facilityId }),
  ]);

  const rows = (ledgerRes.data ?? []) as LedgerRow[];
  const balance = (creditRes.data as number) ?? 0;
  return { balance, rows };
}

export default async function MembershipPage({
  searchParams,
}: {
  searchParams?: { amount?: string };
}) {
  const [{ balance, rows }, billing] = await Promise.all([getLedger(), getBillingSummary()]);
  const committedPay = billing.todayCommittedPay + billing.upcomingCommittedPay;
  const projectedBalance = balance - committedPay;
  const shortfall = Math.max(0, -projectedBalance);
  const initialAmount = Number(searchParams?.amount);
  const recommendedTier = recommendedTierForShortfall(shortfall || Math.max(billing.openExposurePay, 500000));

  return (
    <main className="px-4 pb-28">
      <h1 className="text-[22px] font-extrabold text-ink mt-3 mb-4 px-1">크레딧·정산</h1>

      {/* 현재 잔액 */}
      <div className={`rounded-2xl p-5 mb-6 flex items-center justify-between ${
        balance < 0 ? 'bg-red-500' : 'bg-primary'
      }`}>
        <div>
          <p className="text-[13px] text-white/70 font-semibold">현재 크레딧 잔액</p>
          <p className="text-[30px] font-extrabold text-white leading-tight mt-0.5">
            {balance < 0 ? '-' : ''}{won(balance)}
          </p>
          <p className="text-[12px] text-white/60 mt-1">
            {balance < 0 ? '⚠️ 잔액 부족 — 충전이 필요해요' : '시프트 체크아웃 시 자동 차감'}
          </p>
        </div>
        <div className="text-[44px] opacity-30">💳</div>
      </div>

      <div className="bg-white rounded-2xl shadow-card p-5 mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] text-sub font-semibold">운영 자금 전망</p>
            <p className="text-[19px] font-extrabold text-ink mt-1">
              {shortfall > 0 ? '확정 근무 대비 잔액 부족' : '확정 근무 정산 가능'}
            </p>
          </div>
          <span className={`text-[12px] font-bold px-3 py-1 rounded-full ${
            shortfall > 0 ? 'bg-warn/15 text-warn' : 'bg-success/15 text-success'
          }`}>
            {shortfall > 0 ? '충전 권장' : '정상'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-bg rounded-xl p-3">
            <p className="text-[12px] text-sub">확정 근무 예정</p>
            <p className="text-[15px] font-extrabold text-ink mt-0.5">
              {billing.todayMatchedCount + billing.upcomingMatchedCount}명
            </p>
          </div>
          <div className="bg-bg rounded-xl p-3">
            <p className="text-[12px] text-sub">예상 차감</p>
            <p className="text-[15px] font-extrabold text-ink mt-0.5">{won(committedPay)}</p>
          </div>
        </div>
        <p className="text-[12px] text-sub mt-3">
          추천 충전: {recommendedTier.label} · 공고/매칭이 늘어나면 자동 차감 예정액도 함께 커집니다.
        </p>
      </div>

      {/* 인터랙티브 충전 패널 (Client Component) */}
      <CreditChargePanel
        initialAmount={Number.isFinite(initialAmount) ? initialAmount : recommendedTier.charge}
        currentBalance={balance}
        recommendedAmount={recommendedTier.charge}
      />

      {/* 사용 내역 (실 데이터) */}
      <p className="text-[15px] font-extrabold text-ink mb-3 px-1">사용 내역</p>
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card px-5 py-8 text-center">
          <p className="text-[14px] text-sub">아직 내역이 없어요</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card divide-y divide-line">
          {rows.map((r) => {
            const label   = KIND_LABEL[r.kind] ?? r.kind;
            const dateStr = new Date(r.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
            const timeStr = new Date(r.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
            return (
              <div key={r.id} className="flex items-center justify-between px-4 py-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold text-ink">{label}</p>
                  {r.ref && (
                    <p className="text-[11px] text-sub mt-0.5 truncate font-mono">
                      ref: {r.ref.slice(0, 8)}…
                    </p>
                  )}
                  <p className="text-[11px] text-sub">{dateStr} {timeStr}</p>
                </div>
                <p className={`text-[15px] font-extrabold flex-shrink-0 ml-3 ${
                  r.delta > 0 ? 'text-primary' : 'text-ink'
                }`}>
                  {r.delta > 0 ? '+' : '-'}{won(r.delta)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
