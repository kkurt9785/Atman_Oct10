import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, SectionTitle, BigStat, ActionTile, StatusBadge } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { getStaff, getSummary } from '@/lib/db/staff';
import { getPendingCount } from '@/lib/db/applications';
import { won, hours } from '@/lib/format';

export default async function Home() {
  const [shop, staff, pendingCount] = await Promise.all([
    getShop(),
    getStaff(),
    getPendingCount(),
  ]);

  if (!shop) redirect('/setup/claim-facility');

  const summary = await getSummary(staff);

  return (
    <main className="px-4">
      <div className="px-1 mt-2 mb-4">
        <p className="text-body text-sub">{shop.name}</p>
        <h1 className="text-display font-extrabold text-ink mt-1">원장님, 안녕하세요 👋</h1>
      </div>

      <Card className="shadow-sm">
        <p className="text-label text-sub mb-3">이번 달 현황</p>
        <div className="flex justify-between items-end">
          <BigStat label="예상 인건비" value={won(summary.estimatedPay)} />
          <div className="text-right">
            <p className="text-label text-sub mb-1">총 근로시간</p>
            <p className="text-title font-bold text-ink">{hours(summary.totalMinutes)}</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-line flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-success" />
          <span className="text-body text-ink">지금 <b>{summary.workingNow}명</b> 근무 중이에요</span>
        </div>
      </Card>

      <Card className="mt-4 shadow-sm border border-primary/20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-label font-bold text-sub">급여 운영</p>
            <p className="text-title font-extrabold text-ink mt-1">병원 직접 지급 방식</p>
          </div>
          <span className="text-label font-bold px-3 py-1 rounded-full bg-success/15 text-success">SaaS 분리</span>
        </div>
        <p className="text-label text-sub mt-3 leading-5">워커 임금은 병원이 직접 지급하고, 잇닿 이용료는 지점·공고·근태 사용량 기준의 별도 청구서로 관리합니다.</p>
        <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-label text-sub">이번 달 요금제와 사용량을 확인하세요.</p>
          </div>
          <Link
            href="/membership"
            className="h-10 px-4 rounded-xl bg-primary text-white text-label font-bold flex items-center justify-center flex-shrink-0"
          >
            요금·청구 보기
          </Link>
        </div>
      </Card>

      {pendingCount > 0 && (
        <Link href="/applications">
          <div className="mt-4 bg-primary/10 border border-primary/20 rounded-2xl px-5 py-4 flex items-center justify-between active:opacity-80">
            <div>
              <p className="text-label font-bold text-primary">⚡ 처리 필요</p>
              <p className="text-body font-bold text-ink mt-0.5">지원 대기 {pendingCount}건</p>
            </div>
            <span className="text-sub text-xl">→</span>
          </div>
        </Link>
      )}

      <SectionTitle>빠른 메뉴</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <ActionTile icon="📋" label="시프트 등록" href="/shifts/new" />
        <ActionTile icon="🤝" label="병원 인력풀" href="/workforce" />
        <ActionTile icon="⚙️" label="운영 자동화" href="/operations" />
        <ActionTile icon="🔲" label="QR 체크인" href="/checkin" />
        <ActionTile icon="🕐" label="근태 보기" href="/timesheet" />
        <ActionTile icon="📄" label="급여명세서 발급" href="/payroll" />
        <ActionTile icon="💬" label="워커 채팅" href="/chats" />
        <ActionTile icon="🧾" label="요금제·청구" href="/membership" />
        <ActionTile icon="🏥" label="병원 프로필" href="/settings" />
        <ActionTile icon="🧑‍⚕️" label="직원·면허 심사" href="/staff" />
      </div>

      <SectionTitle>오늘 근무</SectionTitle>
      {staff.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="text-body font-bold text-ink">오늘 근무가 없어요</p>
          <p className="text-label text-sub mt-1">채용확정된 근무가 생기면 표시됩니다.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {staff.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-body font-bold text-ink">{s.name}</p>
                <p className="text-label text-sub">{s.job}</p>
              </div>
              <StatusBadge status={s.todayStatus} />
            </div>
          ))}
        </Card>
      )}
    </main>
  );
}
