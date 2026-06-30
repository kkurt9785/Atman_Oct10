import { adminClient } from '@/lib/supabase';
import { getCurrentFacilityId } from '@/lib/facility';
import CreditChargePanel from './CreditChargePanel';

type LedgerRow = {
  id: string;
  delta: number;
  kind: string;
  ref: string | null;
  created_at: string;
};

const KIND_LABEL: Record<string, string> = {
  charge:     '크레딧 충전',
  shift_wage: '시프트 임금',
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

  const { data } = await sb
    .from('credit_ledger')
    .select('id, delta, kind, ref, created_at')
    .eq('org_id', facilityId)
    .order('created_at', { ascending: false })
    .limit(30);

  const rows = (data ?? []) as LedgerRow[];
  const balance = rows.reduce((s, r) => s + (r.delta ?? 0), 0);
  return { balance, rows };
}

export default async function MembershipPage() {
  const { balance, rows } = await getLedger();

  return (
    <main className="px-4 pb-28">
      <h1 className="text-[22px] font-extrabold text-ink mt-3 mb-4 px-1">크레딧</h1>

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

      {/* 인터랙티브 충전 패널 (Client Component) */}
      <CreditChargePanel />

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
                    <p className="text-[11px] text-tertiary mt-0.5 truncate font-mono">
                      ref: {r.ref.slice(0, 8)}…
                    </p>
                  )}
                  <p className="text-[11px] text-tertiary">{dateStr} {timeStr}</p>
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
