import { Card, SectionTitle, BigStat } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { getStaff } from '@/lib/db/staff';
import { getMonthPayslips, hahrFeature } from '@/lib/db/payroll';
import { won } from '@/lib/mock';

function calcPay(min: number, wage: number) {
  const gross = Math.round((min / 60) * wage);
  const incomeTax = Math.round(gross * 0.03);
  return { gross, net: gross - incomeTax - Math.round(incomeTax * 0.1) };
}

export default async function PayrollPage() {
  const [shop, staff, payslips] = await Promise.all([
    getShop(),
    getStaff(),
    getMonthPayslips(),
  ]);

  const hasHR = hahrFeature(shop.plan);

  // 실제 payslip 데이터가 있으면 사용, 없으면 mock 계산
  const rows = payslips
    ? payslips
    : staff.map((s) => {
        const { gross, net } = calcPay(s.monthMinutes, s.hourlyWage);
        return { id: s.id, name: s.name, grossPay: gross, netPay: net };
      });

  const totalNet = rows.reduce((a, r) => a + r.netPay, 0);

  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-3 px-1">이번 달 급여</h1>

      {!hasHR && (
        <Card className="shadow-sm bg-amber-50 border border-amber-200 mb-4">
          <p className="text-body text-ink">
            💡 <b>노무 기능</b>은 <b>통합·노무 플랜</b>에서 사용할 수 있어요.
          </p>
          <a href="/membership" className="mt-2 block text-label font-bold text-primary">
            멤버십 가입하기 →
          </a>
        </Card>
      )}

      <Card className="shadow-sm">
        <BigStat
          label={payslips ? '실지급(세후)' : '예상 인건비(세후)'}
          value={won(totalNet)}
          sub={`직원 ${rows.length}명 합계`}
        />
        <div className="mt-4 inline-flex items-center gap-1.5 bg-success/10 text-success rounded-full px-3 py-1.5">
          <span>✓</span>
          <span className="text-label font-bold">
            {payslips ? 'wage-engine 항목별 산출' : '기본·연장·야간 자동 분리 계산'}
          </span>
        </div>
      </Card>

      <SectionTitle>직원별 급여</SectionTitle>
      {rows.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-body font-bold text-ink">이번 달 급여 데이터가 없어요</p>
          <p className="text-label text-sub mt-1">체크아웃 완료 후 급여가 계산됩니다.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-body font-bold text-ink">{r.name}</p>
                <p className="text-label text-sub">세전 {won(r.grossPay)}</p>
              </div>
              <p className="text-title font-bold text-ink">{won(r.netPay)}</p>
            </div>
          ))}
        </Card>
      )}

      <p className="text-label text-sub mt-3 px-1">
        포괄임금 금지(2026) 대응 — 실제 근로시간 기준으로 항목을 나눠 계산해요.
      </p>
    </main>
  );
}
