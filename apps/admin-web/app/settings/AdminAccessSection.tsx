'use client';

import { useState, useTransition } from 'react';
import { setAdminPayrollVisibility, type FacilityAdminRow } from '@/lib/actions/facility';

const ROLE_LABEL: Record<FacilityAdminRow['role'], string> = {
  owner: '소유자', super: '전체 관리', operator: '운영 관리자', sales: '영업 조회',
};

export function AdminAccessSection({ admins, facilityWord }: { admins: FacilityAdminRow[]; facilityWord: string }) {
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState(admins);
  const [message, setMessage] = useState('');

  function toggle(userId: string, allow: boolean) {
    setMessage('');
    startTransition(async () => {
      try {
        await setAdminPayrollVisibility(userId, allow);
        setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, canViewPayroll: allow } : r)));
      } catch (err) {
        setMessage(err instanceof Error ? err.message : '변경 실패');
      }
    });
  }

  return (
    <section className="mx-4 mt-4 rounded-2xl bg-white p-5">
      <p className="text-[13px] font-bold text-sub">관리자 권한</p>
      <p className="mt-1 text-[12px] leading-5 text-tertiary">급여 정보(급여 화면·CSV·홈 인건비)는 {facilityWord} 소유자만 봐요. 함께 운영하는 관리자에게 보여주려면 여기서 허용하세요.</p>
      <div className="mt-3 divide-y divide-line">
        {rows.map((admin) => (
          <div key={admin.userId} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold text-ink">{admin.email}</p>
              <p className="mt-0.5 text-[12px] text-sub">{ROLE_LABEL[admin.role]}{admin.role === 'owner' && ' · 급여 항상 열람'}</p>
            </div>
            {admin.role === 'owner' ? (
              <span className="shrink-0 rounded-full bg-bg px-2.5 py-1 text-[12px] font-bold text-sub">열람 가능</span>
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
        ))}
      </div>
      <p className="mt-1 text-[12px] text-tertiary">스위치를 켜면 급여 열람 허용 · 끄면 급여 메뉴와 금액이 숨겨져요. 변경은 감사 기록에 남습니다.</p>
      {message && <p role="alert" className="mt-2 text-[12px] text-warn">{message}</p>}
    </section>
  );
}
