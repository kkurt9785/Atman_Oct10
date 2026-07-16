import Link from 'next/link';
import { Card } from '@/components/ui';
import { getWorkforcePool } from '@/lib/db/workforce';
import { hours } from '@/lib/mock';
import { getAdminContext } from '@/lib/admin-auth';

const ROLE_LABEL = { rn: '간호사 RN', na: '간호조무사 NA' } as const;
const CREDENTIAL_STYLE = {
  valid: 'bg-success/15 text-success',
  expiring: 'bg-amber-100 text-amber-700',
  expired: 'bg-red-50 text-red-600',
  missing: 'bg-line text-sub',
} as const;
const CREDENTIAL_LABEL = { valid: '자격 유효', expiring: '30일 내 만료', expired: '만료 확인', missing: '만료정보 없음' } as const;

export default async function WorkforcePage() {
  const context = await getAdminContext();
  if (!context || context.accessRole === 'sales') {
    return <main className="px-4"><Card className="mt-8 py-10 text-center"><p className="text-body font-bold">인력 운영 권한이 필요해요</p><p className="text-label text-sub mt-2">병원 소유자 또는 운영 담당자에게 요청해 주세요.</p></Card></main>;
  }
  const members = await getWorkforcePool();
  const active = members.filter((member) => member.status === 'active');
  const needsAttention = members.filter((member) => member.credentialStatus === 'expired' || member.credentialStatus === 'expiring');

  return (
    <main className="px-4 pb-28">
      <div className="mt-3 mb-5 px-1">
        <p className="text-label font-bold text-primary">병원 자체 인력풀</p>
        <h1 className="text-display font-extrabold text-ink mt-1">검증된 워커를 다시 부르세요</h1>
        <p className="text-label text-sub mt-2 leading-5">지원 수락 또는 근무 이력이 생기면 자동으로 등록됩니다. 공개 공고 없이 특정 워커에게 반복근무를 요청할 수 있어요.</p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-5">
        <Card className="p-3"><p className="text-[11px] text-sub">전체</p><p className="text-title font-extrabold mt-1">{members.length}명</p></Card>
        <Card className="p-3"><p className="text-[11px] text-sub">초대 가능</p><p className="text-title font-extrabold text-primary mt-1">{active.length}명</p></Card>
        <Card className="p-3"><p className="text-[11px] text-sub">자격 확인</p><p className="text-title font-extrabold text-warn mt-1">{needsAttention.length}건</p></Card>
      </div>

      {members.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-title font-bold text-ink">아직 자체 인력풀이 없어요</p>
          <p className="text-label text-sub mt-2 leading-5">공개 시프트의 지원자를 수락하면<br />이 병원의 인력풀에 자동으로 쌓입니다.</p>
          <Link href="/shifts/new" className="inline-flex mt-5 h-11 px-5 items-center rounded-xl bg-primary text-white text-label font-bold">첫 공고 등록하기</Link>
        </Card>
      ) : (
        <div className="space-y-3">
          {members.map((member) => {
            const inviteHref = `/shifts/new?workerId=${encodeURIComponent(member.workerId)}&workerName=${encodeURIComponent(member.name)}`;
            return (
              <Card key={member.poolId} className="shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-body font-extrabold text-ink">{member.name}</p>
                      <span className="text-[11px] font-bold rounded-full bg-primary/10 text-primary px-2 py-0.5">{ROLE_LABEL[member.role]}</span>
                    </div>
                    <p className="text-label text-sub mt-1">완료 {member.completedShiftCount}회 · 누적 {hours(member.totalWorkedMinutes)}</p>
                    {member.lastWorkedAt && <p className="text-[11px] text-sub mt-1">최근 근무 {member.lastWorkedAt}</p>}
                  </div>
                  <span className={`shrink-0 text-[11px] font-bold rounded-full px-2.5 py-1 ${CREDENTIAL_STYLE[member.credentialStatus]}`}>
                    {CREDENTIAL_LABEL[member.credentialStatus]}
                  </span>
                </div>

                {member.credentialExpiresAt && (
                  <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-label text-sub">
                    {member.credentialLabel} 유효기간 · <b className="text-ink">{member.credentialExpiresAt}</b>
                  </p>
                )}
                {(member.experienceYears || member.departmentTags.length > 0) && (
                  <p className="text-label text-sub mt-3">
                    {[member.experienceYears, ...member.departmentTags.slice(0, 3)].filter(Boolean).join(' · ')}
                  </p>
                )}

                <Link
                  href={inviteHref}
                  aria-disabled={member.status !== 'active' || member.credentialStatus === 'expired'}
                  className={`mt-4 h-11 rounded-xl flex items-center justify-center text-label font-extrabold ${member.status === 'active' && member.credentialStatus !== 'expired' ? 'bg-primary text-white' : 'bg-line text-sub pointer-events-none'}`}
                >
                  {member.credentialStatus === 'expired' ? '자격 갱신 후 요청 가능' : '반복근무 요청하기'}
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
