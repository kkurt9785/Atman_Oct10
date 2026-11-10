'use client';

import { useState, useTransition } from 'react';
import { createAdminInviteResult, removeInvitedAdminResult, setAdminPayrollVisibilityResult, type FacilityAdminRow } from '@/lib/actions/facility';

const ROLE_LABEL: Record<FacilityAdminRow['role'], string> = {
  owner: '소유자', super: '전체 관리', operator: '운영 관리자', sales: '영업 조회',
};

export function AdminAccessSection({ admins, facilityWord, canInvite = false }: { admins: FacilityAdminRow[]; facilityWord: string; canInvite?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState(admins);
  const [message, setMessage] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  function toggle(userId: string, allow: boolean) {
    setMessage('');
    startTransition(async () => {
      const result = await setAdminPayrollVisibilityResult(userId, allow).catch(() => null);
      if (!result?.ok) { setMessage(result?.error ?? '변경하지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
      setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, canViewPayroll: allow } : r)));
    });
  }

  function createInvite() {
    setMessage(''); setCopied(false);
    startTransition(async () => {
      const result = await createAdminInviteResult().catch(() => null);
      if (!result?.ok) { setMessage(result?.error ?? '초대 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
      setInviteUrl(`${window.location.origin}/setup/join-admin?t=${result.data.token}`);
    });
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); } catch { setMessage('복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.'); }
  }

  function remove(userId: string) {
    setMessage('');
    startTransition(async () => {
      const result = await removeInvitedAdminResult(userId).catch(() => null);
      if (!result?.ok) { setMessage(result?.error ?? '내보내지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
      setRows((prev) => prev.filter((r) => r.userId !== userId));
      setRemoving(null);
    });
  }

  return (
    <section className="mx-4 mt-4 rounded-2xl bg-white p-5">
      <p className="text-[0.8125rem] font-bold text-sub">관리자 권한</p>
      <p className="mt-1 text-[0.75rem] leading-5 text-tertiary">급여 정보(급여 화면·CSV·홈 인건비)는 {facilityWord} 소유자만 봐요. 함께 운영하는 관리자에게 보여주려면 여기서 허용하세요.</p>
      <div className="mt-3 divide-y divide-line">
        {rows.map((admin) => (
          <div key={admin.userId} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[0.875rem] font-bold text-ink">{admin.email}</p>
                <p className="mt-0.5 text-[0.75rem] text-sub">{ROLE_LABEL[admin.role]}{admin.role === 'owner' && ' · 급여 항상 열람'}</p>
              </div>
              {admin.role === 'owner' ? (
                <span className="shrink-0 rounded-full bg-bg px-2.5 py-1 text-[0.75rem] font-bold text-sub">열람 가능</span>
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={admin.canViewPayroll}
                  aria-label={`${admin.email} 급여 열람`}
                  disabled={isPending}
                  onClick={() => toggle(admin.userId, !admin.canViewPayroll)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${admin.canViewPayroll ? 'bg-primary' : 'bg-line'}`}
                >
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${admin.canViewPayroll ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              )}
            </div>
            {canInvite && admin.invited && (removing === admin.userId ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-bg px-3 py-2">
                <p className="text-[0.75rem] text-ink">이 관리자를 내보낼까요? 바로 접속이 끊겨요.</p>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" disabled={isPending} onClick={() => setRemoving(null)} className="min-h-11 rounded-xl bg-white px-3 text-[0.75rem] font-bold text-sub">취소</button>
                  <button type="button" disabled={isPending} onClick={() => remove(admin.userId)} className="min-h-11 rounded-xl bg-white px-3 text-[0.75rem] font-extrabold text-red-600 disabled:opacity-60">내보내기</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setRemoving(admin.userId)} className="mt-1 min-h-11 text-[0.75rem] font-bold text-sub underline underline-offset-2">관리자에서 내보내기</button>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-1 text-[0.75rem] text-tertiary">스위치를 켜면 급여 열람 허용 · 끄면 급여 메뉴와 금액이 숨겨져요. 변경은 감사 기록에 남아요.</p>

      {canInvite && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[0.8125rem] font-bold text-ink">관리자 추가</p>
          <p className="mt-1 text-[0.75rem] leading-5 text-sub">실장님·매니저처럼 함께 운영할 분에게 초대 링크를 보내세요. 받은 분이 관리자 앱에 로그인한 뒤 링크를 열면 운영 관리자로 들어와요. 급여는 위 스위치를 켜야 보여요.</p>
          {inviteUrl ? (
            <div className="mt-3 rounded-xl bg-bg p-3">
              <p className="break-all text-[0.75rem] leading-5 text-ink">{inviteUrl}</p>
              <button type="button" onClick={copyInvite} className="mt-2 h-11 w-full rounded-xl bg-ink text-[0.8125rem] font-bold text-white">{copied ? '복사했어요 ✓' : '링크 복사'}</button>
              <p className="mt-2 text-[0.6875rem] leading-4 text-sub">24시간 안에 한 사람만 쓸 수 있어요. 여러 명을 추가하려면 한 명마다 새로 만들어 주세요.</p>
            </div>
          ) : (
            <button type="button" disabled={isPending} onClick={createInvite} className="mt-3 h-11 w-full rounded-xl border border-line bg-white text-[0.8125rem] font-bold text-ink disabled:opacity-60">＋ 초대 링크 만들기</button>
          )}
        </div>
      )}
      {message && <p role="alert" className="mt-2 text-[0.75rem] text-warn">{message}</p>}
    </section>
  );
}
