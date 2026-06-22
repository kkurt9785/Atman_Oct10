import { Card, SectionTitle, BigStat, PrimaryButton } from '@/components/ui';
import { STAFF, won } from '@/lib/mock';

// 간이 계산 (실제는 @itdat/wage-engine 항목별 산출). 3.3% 원천징수.
function pay(min: number, wage: number) {
  const gross = Math.round((min / 60) * wage);
  const incomeTax = Math.round(gross * 0.03);
  const localTax = Math.round(incomeTax * 0.1);
  return { gross, net: gross - incomeTax - localTax };
}
const rows = STAFF.map((s) => ({ ...s, ...pay(s.monthMinutes, s.hourlyWage) }));
const totalNet = rows.reduce((a, r) => a + r.net, 0);

export default function PayrollPage() {
  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-3 px-1">이번 달 급여</h1>

      <Card className="shadow-sm">
        <BigStat label="실지급 예정(세후)" value={won(totalNet)} sub={`직원 ${rows.length}명 합계`} />
        <div className="mt-4 inline-flex items-center gap-1.5 bg-success/10 text-success rounded-full px-3 py-1.5">
          <span>✓</span><span className="text-label font-bold">기본·연장·야간 자동 분리 계산</span>
        </div>
      </Card>

      <SectionTitle>직원별 급여</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-body font-bold text-ink">{r.name}</p>
              <p className="text-label text-sub">세전 {won(r.gross)}</p>
            </div>
            <p className="text-title font-bold text-ink">{won(r.net)}</p>
          </div>
        ))}
      </Card>

      <p className="text-label text-sub mt-3 px-1">
        포괄임금 금지(2026) 대응 — 실제 근로시간 기준으로 항목을 나눠 계산해요.
      </p>

      <div className="mt-4">
        <PrimaryButton href="/payroll">📄 전체 명세서 발급하기</PrimaryButton>
      </div>
    </main>
  );
}
