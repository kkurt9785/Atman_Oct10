import { notFound } from 'next/navigation';
import { getPlatformAdminSession } from '@/lib/platform-admin';
import { listSelfRegisteredFacilities, listRegistrationRequests } from '@/lib/actions/platform';
import { ManageBackLink } from '@/components/ManageBackLink';
import { ApprovalCard, RequestCard } from './ApprovalCard';
import { getPendingWorkers } from '@/lib/db/workers';
import { WorkerApprovalCard } from '@/app/staff/WorkerApprovalCard';

export const dynamic = 'force-dynamic';

// 잇닿 운영자 전용: 셀프 등록 사업장 승인/반려 + 수동 등록 요청 검토. 운영자가 아니면 존재 자체를 숨긴다(404).
export default async function PlatformFacilitiesPage() {
  const session = await getPlatformAdminSession();
  if (!session) notFound();
  const [pending, recent, requests, pendingWorkers] = await Promise.all([
    listSelfRegisteredFacilities(true),
    listSelfRegisteredFacilities(false).then((rows) => rows.filter((r) => r.approved_at).slice(0, 10)),
    listRegistrationRequests(),
    getPendingWorkers(),
  ]);

  return (
    <main className="min-h-screen bg-surface px-4 pb-24">
      <div className="pt-1"><ManageBackLink href="/more" label="관리" /></div>
      <div className="mt-2 px-1">
        <p className="text-label font-bold text-primary">잇닿 운영자 전용</p>
        <h1 className="mt-1 text-display font-extrabold text-ink">등록 심사</h1>
        <p className="mt-2 text-body text-sub">셀프 등록한 사업장은 사업자등록번호를 확인한 뒤 승인해야 공고를 올릴 수 있어요. 운영자 {session.user.email ?? (session.user.user_metadata?.name as string | undefined) ?? '카카오 계정'}</p>
      </div>

      <section className="mt-6">
        <p className="mb-2 px-1 text-label font-bold text-sub">승인 대기 {pending.length}건</p>
        {pending.length === 0
          ? <p className="rounded-2xl bg-white p-5 text-center text-[14px] text-sub">대기 중인 사업장이 없어요.</p>
          : <div className="space-y-3">{pending.map((f) => <ApprovalCard key={f.id} facility={f} />)}</div>}
      </section>

      <section className="mt-8">
        <p className="mb-2 px-1 text-label font-bold text-sub">수동 등록 요청 {requests.length}건</p>
        {requests.length === 0
          ? <p className="rounded-2xl bg-white p-5 text-center text-[14px] text-sub">검토할 요청이 없어요.</p>
          : <div className="space-y-3">{requests.map((r) => <RequestCard key={r.id} request={r} />)}</div>}
        <p className="mt-2 px-1 text-[11px] leading-4 text-tertiary">요청은 사업장 계정이 없을 때 남긴 것이라, 연락해서 셀프 등록을 안내하거나 잇닿이 직접 등록한 뒤 초대 코드를 보내요.</p>
      </section>

      <section className="mt-8">
        <p className="mb-2 px-1 text-label font-bold text-sub">워커 자격 심사 대기 {pendingWorkers.length}건</p>
        {pendingWorkers.length === 0
          ? <p className="rounded-2xl bg-white p-5 text-center text-[14px] text-sub">심사할 워커가 없어요. 간호사·간호조무사·약사는 사업장이 채용 전 직접 확인하고, 약국 전산·사무직만 여기서 이력서를 확인해요.</p>
          : <div className="space-y-3">{pendingWorkers.map((w) => <WorkerApprovalCard key={w.id} worker={w} />)}</div>}
      </section>

      {recent.length > 0 && (
        <section className="mt-8">
          <p className="mb-2 px-1 text-label font-bold text-sub">최근 승인 {recent.length}건</p>
          <ul className="divide-y divide-line rounded-2xl bg-white">
            {recent.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0"><p className="truncate text-[14px] font-bold text-ink">{f.name}</p><p className="truncate text-[12px] text-sub">{f.business_registration_number} · {f.admin_email ?? '관리자 없음'}</p></div>
                <span className="shrink-0 text-[11px] text-sub">{new Date(f.approved_at as string).toLocaleDateString('ko-KR')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
