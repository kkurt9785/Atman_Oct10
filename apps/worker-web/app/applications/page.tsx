'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { QRModal } from '@/components/shifts/QRModal';

type ApplicationStatus = 'applied' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

type Application = {
  id: string;
  status: ApplicationStatus;
  applied_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  shift: {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    is_overnight: boolean;
    estimated_total_pay: number;
    department: string | null;
    description: string;
  };
};

const STATUS_CONFIG: Record<ApplicationStatus, { label: string; className: string }> = {
  applied:   { label: '검토 중',  className: 'bg-primary-light text-primary' },
  accepted:  { label: '수락됨',  className: 'bg-[#E5FAF4] text-success' },
  rejected:  { label: '미선정',  className: 'bg-[#F2F4F6] text-tertiary' },
  cancelled: { label: '취소됨',  className: 'bg-[#F2F4F6] text-tertiary' },
  expired:   { label: '만료',    className: 'bg-[#F2F4F6] text-tertiary' },
};

function ApplicationCard({
  app,
  onCancel,
  onQR,
}: {
  app: Application;
  onCancel: (id: string) => void;
  onQR: (app: Application) => void;
}) {
  const { label, className } = STATUS_CONFIG[app.status];
  const start = app.shift.start_time.slice(0, 5);
  const end = app.shift.end_time.slice(0, 5);
  const pay = app.shift.estimated_total_pay.toLocaleString('ko-KR');
  const appliedDate = new Date(app.applied_at).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
  });

  const today = new Date().toISOString().slice(0, 10);
  const isToday = app.shift.shift_date === today;
  const isCheckedIn  = !!app.checked_in_at;
  const isCheckedOut = !!app.checked_out_at;

  // 수락 배지 오버라이드
  const dDiff = Math.ceil(
    (new Date(app.shift.shift_date).getTime() - new Date(today).getTime()) / 86400000
  );
  const dLabel =
    dDiff === 0 ? '오늘' :
    dDiff === 1 ? '내일' :
    dDiff > 0   ? `D-${dDiff}` : null;

  return (
    <div className="bg-white rounded-card shadow-card p-5 mb-3">
      {/* 날짜 + 상태 뱃지 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-sub">{app.shift.shift_date}</span>
        <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${className}`}>
          {label}
        </span>
      </div>

      {/* 시간 */}
      <p className="text-[20px] font-extrabold text-ink leading-tight mb-1">
        {start} – {end}{app.shift.is_overnight ? ' (익일)' : ''}
      </p>

      {/* 부서 / 설명 */}
      {app.shift.department && (
        <p className="text-[13px] text-tertiary mb-0.5">{app.shift.department}</p>
      )}
      <p className="text-[14px] text-sub line-clamp-2 mb-3">{app.shift.description}</p>

      {/* 지급액 + 지원일 */}
      <div className="flex items-center justify-between pt-3 border-t border-line">
        <div>
          <p className="text-[12px] text-tertiary">예상 지급액</p>
          <p className="text-[17px] font-extrabold text-ink">₩{pay}</p>
        </div>
        <p className="text-[12px] text-tertiary">{appliedDate} 지원</p>
      </div>

      {/* 수락됨 — 날짜/체크인 상태별 분기 */}
      {app.status === 'accepted' && (
        <>
          {isCheckedOut ? (
            /* 체크아웃 완료 */
            <div className="mt-3 p-3 bg-bg rounded-xl flex items-center gap-2">
              <span className="text-success">✅</span>
              <p className="text-[13px] font-semibold text-sub">근무 완료</p>
            </div>
          ) : isCheckedIn ? (
            /* 체크인 완료 — 근무 중 */
            <div className="mt-3 p-3 bg-primary/8 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <p className="text-[13px] font-semibold text-primary">근무 중</p>
              </div>
              <button onClick={() => onQR(app)} className="text-[12px] font-bold text-primary underline">
                QR 체크아웃
              </button>
            </div>
          ) : isToday ? (
            /* 오늘 시프트 — QR 체크인 */
            <button
              onClick={() => onQR(app)}
              className="mt-3 w-full h-12 bg-[#E5FAF4] text-success text-[15px] font-bold rounded-xl flex items-center justify-center gap-2 active:opacity-80"
            >
              🔲 QR 체크인
            </button>
          ) : (
            /* 미래 시프트 — D-day 안내 */
            <div className="mt-3 p-3 bg-bg rounded-xl flex items-center gap-2">
              <span className="text-success">✅</span>
              <p className="text-[13px] font-semibold text-sub">
                수락됨{dLabel ? ` · ${dLabel}` : ''}
              </p>
            </div>
          )}
        </>
      )}

      {/* 검토 중 — 취소 버튼 */}
      {app.status === 'applied' && (
        <button
          onClick={() => onCancel(app.id)}
          className="mt-3 w-full h-11 border border-line rounded-btn text-[14px] font-semibold text-sub active:bg-bg"
        >
          지원 취소
        </button>
      )}
    </div>
  );
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [noAuth, setNoAuth] = useState(false);
  const [qrTarget, setQrTarget] = useState<Application | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setNoAuth(true); setLoading(false); return; }

      const { data: worker } = await supabase
        .from('workers')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (!worker) { setNoAuth(true); setLoading(false); return; }

      const { data } = await supabase
        .from('shift_applications')
        .select(`
          id, status, applied_at, checked_in_at, checked_out_at,
          shift:shifts (
            id, shift_date, start_time, end_time, is_overnight,
            estimated_total_pay, department, description
          )
        `)
        .eq('worker_id', worker.id)
        .order('applied_at', { ascending: false });

      setApps((data as unknown as Application[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  async function handleCancel(applicationId: string) {
    const { error } = await supabase
      .from('shift_applications')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', applicationId);

    if (!error) {
      setApps((prev) =>
        prev.map((a) => (a.id === applicationId ? { ...a, status: 'cancelled' } : a))
      );
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-[15px] text-sub">불러오는 중...</p>
      </div>
    );
  }

  if (noAuth) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 px-6">
        <span className="text-5xl">🔐</span>
        <p className="text-[17px] font-bold text-ink">로그인이 필요해요</p>
        <p className="text-[14px] text-sub text-center">회원가입 후 지원 현황을 확인할 수 있어요</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-10">
      <div className="pt-14 pb-6">
        <h1 className="text-[28px] font-extrabold text-ink">내 지원 현황</h1>
        <p className="text-[14px] text-sub mt-1">총 {apps.length}건</p>
      </div>

      {apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <span className="text-5xl">📋</span>
          <p className="text-[17px] font-bold text-ink">아직 지원한 시프트가 없어요</p>
          <p className="text-[14px] text-sub text-center">마음에 드는 시프트에 지원해 보세요</p>
        </div>
      ) : (
        apps.map((a) => (
          <ApplicationCard key={a.id} app={a} onCancel={handleCancel} onQR={setQrTarget} />
        ))
      )}

      {qrTarget && (
        <QRModal
          applicationId={qrTarget.id}
          shiftDate={qrTarget.shift.shift_date}
          startTime={qrTarget.shift.start_time}
          onClose={() => setQrTarget(null)}
        />
      )}
    </div>
  );
}
