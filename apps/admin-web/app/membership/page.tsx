import { Card, SectionTitle, BigStat, PrimaryButton } from '@/components/ui';
import { getMembership, getAllTiers } from '@/lib/db/membership';
import { won } from '@/lib/mock';

const KIND_LABEL: Record<string, string> = {
  signup_payback: '가입 즉시 페이백',
  cycle_payback: '이용 페이백',
  earn: '결제 적립',
  spend: '크레딧 사용',
  expire: '소멸',
  admin_adjust: '관리자 조정',
};

function periodEndLabel(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default async function MembershipPage() {
  const [membership, tiers] = await Promise.all([getMembership(), getAllTiers()]);

  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-3 px-1">멤버십·크레딧</h1>

      {membership ? (
        <>
          {/* 현재 멤버십 */}
          <Card className="shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-label font-bold text-primary bg-primary/10 rounded-full px-3 py-1">
                {membership.tierName}
              </span>
              <span className="text-label text-sub">{membership.consecutiveCycles}주기 연속 이용 중</span>
            </div>
            <BigStat label="크레딧 잔액" value={won(membership.creditBalance)} />
            <p className="text-label text-sub mt-2">
              다음 주기 마감 {periodEndLabel(membership.periodEnd)} · 자동 갱신
            </p>
            <div className="mt-4 pt-4 border-t border-line">
              <p className="text-label text-sub mb-1">이번 주기 활동 페이백 조건</p>
              <p className="text-body text-ink">
                결제 <b>{won(membership.paybackThreshold)} 이상</b> 이용 시 회비 전액 크레딧 환급
              </p>
              <p className="text-label text-sub mt-1">
                결제액의 {(membership.earnRate * 100).toFixed(1)}% 자동 적립
              </p>
            </div>
          </Card>

          {/* 크레딧 이력 */}
          {membership.recentCredits.length > 0 && (
            <>
              <SectionTitle>최근 크레딧 내역</SectionTitle>
              <Card className="divide-y divide-line p-0">
                {membership.recentCredits.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-5 py-4">
                    <div>
                      <p className="text-body font-bold text-ink">
                        {KIND_LABEL[c.kind] ?? c.kind}
                      </p>
                      {c.note && <p className="text-label text-sub">{c.note}</p>}
                    </div>
                    <p
                      className={`text-title font-bold ${
                        c.delta > 0 ? 'text-success' : 'text-red-500'
                      }`}
                    >
                      {c.delta > 0 ? '+' : ''}
                      {won(c.delta)}
                    </p>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      ) : (
        /* 미가입 상태 */
        <Card className="shadow-sm text-center py-6">
          <p className="text-3xl mb-3">🎁</p>
          <p className="text-title font-bold text-ink mb-1">아직 멤버십이 없어요</p>
          <p className="text-body text-sub mb-1">가입 즉시 회비 100% 크레딧 환급!</p>
          <p className="text-label text-sub">크레딧으로 수수료 결제 가능</p>
        </Card>
      )}

      {/* 플랜 목록 */}
      {tiers.length > 0 && (
        <>
          <SectionTitle>{membership ? '플랜 업그레이드' : '멤버십 가입'}</SectionTitle>
          <div className="flex flex-col gap-3">
            {tiers.map((t) => (
              <Card
                key={t.code}
                className={`relative ${
                  membership?.tierCode === t.code ? 'border-2 border-primary' : ''
                }`}
              >
                {membership?.tierCode === t.code && (
                  <span className="absolute top-3 right-4 text-label font-bold text-primary">
                    현재 플랜
                  </span>
                )}
                <div className="flex items-end gap-2 mb-2">
                  <p className="text-title font-extrabold text-ink">{t.name}</p>
                  <p className="text-body text-sub mb-0.5">월 {won(t.monthlyFee)}</p>
                </div>
                <ul className="text-label text-sub space-y-1 mb-4">
                  <li>✓ 가입 즉시 회비 100% 크레딧 환급</li>
                  <li>✓ 결제액 {(t.earnRate * 100).toFixed(1)}% 자동 적립</li>
                  <li>✓ {won(t.paybackThreshold)} 이상 이용 시 회비 재환급</li>
                  {t.grantsPlanCode === 'bundle' && (
                    <li>✓ 매칭 + 노무관리 통합 기능 포함</li>
                  )}
                </ul>
                {membership?.tierCode !== t.code && (
                  <PrimaryButton href="#">
                    {membership ? `${t.name}으로 변경` : `${t.name} 가입하기`}
                  </PrimaryButton>
                )}
              </Card>
            ))}
          </div>
        </>
      )}

      {/* 플랜 없을 때 기본 안내 */}
      {tiers.length === 0 && !membership && (
        <div className="mt-4">
          <PrimaryButton href="#">멤버십 가입하기</PrimaryButton>
        </div>
      )}

      <p className="text-label text-sub text-center mt-6 mb-2">
        크레딧은 잇닿 수수료 결제에만 사용할 수 있어요
      </p>
    </main>
  );
}
