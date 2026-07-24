'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { QRModal } from '@/components/shifts/QRModal';
import { dateKST } from '@/lib/date';
import { cancelApplication, respondToInvitation } from '@/lib/shifts';
import { facilityName, mobilityLabel, timeLabel } from '@/lib/shift-display';
import { AttendanceActionButton } from '@/components/attendance/AttendanceActionButton';

// ── 타입 ───────────────────────────────────────────────────────
type ApplicationStatus = 'invited' | 'applied' | 'accepted' | 'rejected' | 'cancelled' | 'expired' | 'completed';

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
    facilities?: { name: string; address_text: string } | Array<{ name: string; address_text: string }> | null;
  };
};

// ── 상수 ───────────────────────────────────────────────────────
const STATUS_CONFIG: Record<ApplicationStatus, { label: string; description: string; className: string }> = {
  invited: {
    label: '병원 직접 요청',
    description: '이전에 함께한 병원에서 반복근무를 요청했어요. 수락 여부를 선택해 주세요.',
    className: 'bg-amber-100 text-amber-700',
  },
  applied: {
    label: '병원 확인 중',
    description: '지원이 접수됐고 병원에서 확인하고 있어요.',
    className: 'bg-primary/10 text-primary',
  },
  accepted: {
    label: '병원 채용확정',
    description: '병원이 수락했어요. 근무 당일 QR 체크인을 준비해 주세요.',
    className: 'bg-[#E5FAF4] text-success',
  },
  rejected: {
    label: '미선정',
    description: '이번 시프트는 다른 지원자가 선정됐어요.',
    className: 'bg-[#F2F4F6] text-tertiary',
  },
  cancelled: {
    label: '취소됨',
    description: '지원이 취소됐어요.',
    className: 'bg-[#F2F4F6] text-tertiary',
  },
  expired: {
    label: '만료',
    description: '시프트 시간이 지나 지원이 만료됐어요.',
    className: 'bg-[#F2F4F6] text-tertiary',
  },
  completed: {
    label: '근무 완료',
    description: '체크아웃이 완료됐고 급여 지급현황에서 확인할 수 있어요.',
    className: 'bg-[#E5FAF4] text-success',
  },
};

function stepState(app: Application, step: 'applied' | 'accepted' | 'work') {
  if (app.status === 'invited') return step === 'applied' ? 'current' : 'muted';
  if (['rejected', 'cancelled', 'expired'].includes(app.status)) return 'muted';
  if (step === 'applied') return 'done';
  if (step === 'accepted') return app.status === 'accepted' || app.status === 'completed' ? 'done' : 'current';
  if (app.status === 'completed' || app.checked_out_at) return 'done';
  if (app.checked_in_at) return 'current';
  return app.status === 'accepted' ? 'current' : 'muted';
}

function StatusSteps({ app }: { app: Application }) {
  const steps = [
    { key: 'applied' as const, label: '지원함' },
    { key: 'accepted' as const, label: '채용확정' },
    { key: 'work' as const, label: app.checked_in_at ? '근무 중' : '출근 예정' },
  ];

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {steps.map((step) => {
        const state = stepState(app, step.key);
        return (
          <div
            key={step.key}
            className={`rounded-xl px-2.5 py-2 text-center text-[12px] font-bold ${
              state === 'done'
                ? 'bg-[#E5FAF4] text-success'
                : state === 'current'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-bg text-tertiary'
            }`}
          >
            {step.label}
          </div>
        );
      })}
    </div>
  );
}

// ── 지원 카드 ──────────────────────────────────────────────────
function ApplicationCard({
  app,
  onCancel,
  onQR,
  onInvitation,
}: {
  app: Application;
  onCancel: (id: string) => void;
  onQR: (app: Application) => void;
  onInvitation: (id: string, accept: boolean) => void;
}) {
  const { label, description, className } = STATUS_CONFIG[app.status];
  const pay   = app.shift.estimated_total_pay.toLocaleString('ko-KR');
  const appliedDate = new Date(app.applied_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

  const today      = dateKST();
  const isToday    = app.shift.shift_date === today;
  const isCheckedIn  = !!app.checked_in_at;
  const isCheckedOut = !!app.checked_out_at;

  const dDiff = Math.ceil(
    (new Date(app.shift.shift_date).getTime() - new Date(today).getTime()) / 86400000
  );
  const dLabel =
    dDiff === 0 ? '오늘' : dDiff === 1 ? '내일' : dDiff > 0 ? `D-${dDiff}` : null;

  return (
    <div className="bg-white rounded-card shadow-card p-5 mb-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-sub">{app.shift.shift_date}</span>
        <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${className}`}>{label}</span>
      </div>
      <p className="text-[15px] font-extrabold text-ink truncate mb-1">{facilityName(app.shift)}</p>
      <p className="text-[20px] font-extrabold text-ink leading-tight mb-1">
        {timeLabel(app.shift)}
      </p>
      {app.shift.department && (
        <p className="text-[13px] text-tertiary mb-0.5">{app.shift.department}</p>
      )}
      <p className="text-[13px] font-semibold text-primary mb-2">{mobilityLabel(app.shift)}</p>
      <p className="text-[14px] text-sub line-clamp-2 mb-3">{app.shift.description}</p>
      <p className="text-[13px] text-sub bg-bg rounded-xl px-3 py-2 mb-3">{description}</p>
      <StatusSteps app={app} />

      {app.status === 'invited' && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={() => onInvitation(app.id, false)} className="h-12 rounded-xl border border-line text-[14px] font-bold text-sub">이번에는 어려워요</button>
          <button onClick={() => onInvitation(app.id, true)} className="h-12 rounded-xl bg-primary text-white text-[14px] font-extrabold">근무 요청 수락</button>
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-line">
        <div>
          <p className="text-[12px] text-tertiary">예상 지급액</p>
          <p className="text-[17px] font-extrabold text-ink">₩{pay}</p>
        </div>
        <p className="text-[12px] text-tertiary">{appliedDate} 지원</p>
      </div>

      {app.status === 'accepted' && (
        <>
          {isCheckedOut ? (
            <div className="mt-3 p-3 bg-bg rounded-xl flex items-center gap-2">
              <span className="text-success">✅</span>
              <p className="text-[13px] font-semibold text-sub">근무 완료</p>
            </div>
          ) : isCheckedIn ? (
            <div className="mt-3 p-3 bg-primary/8 rounded-xl">
              <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <p className="text-[13px] font-semibold text-primary">근무 중</p>
              </div>
              <button onClick={() => onQR(app)} className="text-[12px] font-bold text-primary underline">
                QR 체크아웃
              </button>
              </div>
              <AttendanceActionButton targetType="shift" targetId={app.id} action="check_out"/>
            </div>
          ) : isToday ? (
            <div><AttendanceActionButton targetType="shift" targetId={app.id} action="check_in"/><button onClick={() => onQR(app)} className="mt-2 h-11 w-full rounded-xl border border-line text-[13px] font-bold text-sub">기존 QR 방식 사용</button></div>
          ) : (
            <div className="mt-3 p-3 bg-bg rounded-xl flex items-center gap-2">
              <span className="text-success">✅</span>
              <p className="text-[13px] font-semibold text-sub">
                수락됨{dLabel ? ` · ${dLabel}` : ''}
              </p>
            </div>
          )}
          <Link
            href={`/chat/${app.id}`}
            className="mt-2 w-full h-11 border border-primary/30 rounded-btn text-[14px] font-semibold text-primary flex items-center justify-center gap-1.5 active:bg-primary/5"
          >
            💬 병원 채팅
          </Link>
        </>
      )}

      {app.status === 'completed' && (
        <Link
          href={`/chat/${app.id}`}
          className="mt-3 w-full h-11 border border-line rounded-btn text-[14px] font-semibold text-sub flex items-center justify-center gap-1.5 active:bg-bg"
        >
          💬 채팅 기록 보기
        </Link>
      )}

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

// ── 메인 페이지 ────────────────────────────────────────────────
export default function ApplicationsPage() {
  const router = useRouter();
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [apps, setApps]     = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrTarget, setQrTarget] = useState<Application | null>(null);
  const [actionNotice, setActionNotice] = useState('');

  // 워커 ID + 지원 현황 초기 로드
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/onboarding'); return; }

      const [{ data: worker }, { data: profile }] = await Promise.all([
        supabase.from('workers').select('id').eq('auth_user_id', user.id).single(),
        supabase.from('profiles').select('onboarding_done').single(),
      ]);

      if (!worker) {
        // 온보딩 완료 → 심사 대기 중 (내 활동 빈 화면)
        // 온보딩 미완료 → 온보딩으로
        if (!profile?.onboarding_done) { router.replace('/onboarding'); return; }
        setLoading(false);
        return;
      }

      setWorkerId(worker.id);

      const { data } = await supabase
        .from('shift_applications')
        .select(`
          id, status, applied_at, checked_in_at, checked_out_at,
          shift:shifts (
            id, shift_date, start_time, end_time, is_overnight,
            estimated_total_pay, department, description,
            facilities ( name, address_text )
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
    if (!workerId) return;
    const ok = await cancelApplication(applicationId);
    if (ok) {
      setApps((prev) => prev.map((a) => a.id === applicationId ? { ...a, status: 'cancelled' as const } : a));
    } else {
      setActionNotice('취소할 수 없는 지원이에요.');
    }
  }

  async function handleInvitation(applicationId: string, accept: boolean) {
    const ok = await respondToInvitation(applicationId, accept);
    if (!ok) { setActionNotice('요청 상태를 변경하지 못했어요. 다시 시도해 주세요.'); return; }
    setApps((prev) => prev.map((app) => app.id === applicationId
      ? { ...app, status: accept ? 'applied' as const : 'cancelled' as const }
      : app));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-[15px] text-sub">불러오는 중...</p>
      </div>
    );
  }

  if (!workerId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 px-8 text-center">
        <p className="text-4xl">⏳</p>
        <p className="text-[18px] font-bold text-ink">심사 중이에요</p>
        <p className="text-[14px] text-sub">서류 검토 후 승인되면 지원 및 활동 내역을 확인할 수 있어요.</p>
      </div>
    );
  }



  return (
    <div className="px-4 pb-10">
      <div className="pt-14 pb-4">
        <h1 className="text-[28px] font-extrabold text-ink">내 활동</h1>
      </div>

      <div className="flex items-center justify-between mb-5">
        <p className="text-[14px] font-bold text-ink">지원 현황 {apps.length > 0 ? `(${apps.length})` : ''}</p>
        <button onClick={() => router.push('/earnings')} className="text-[13px] font-bold text-primary bg-primary/8 px-3 py-2 rounded-xl">
          급여 지급현황 →
        </button>
      </div>

      {actionNotice && (
        <p role="alert" className="mb-3 rounded-xl bg-amber-50 text-amber-700 text-[13px] font-bold px-3 py-2">{actionNotice}</p>
      )}

      {apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <span className="text-5xl">📋</span>
            <p className="text-[17px] font-bold text-ink">아직 지원한 시프트가 없어요</p>
            <p className="text-[14px] text-sub text-center">마음에 드는 시프트에 지원해 보세요</p>
          </div>
        ) : (
          apps.map((a) => (
            <ApplicationCard key={a.id} app={a} onCancel={handleCancel} onQR={setQrTarget} onInvitation={handleInvitation} />
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
