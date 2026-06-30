'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { QRModal } from '@/components/shifts/QRModal';

// ── 타입 ───────────────────────────────────────────────────────
type ApplicationStatus = 'applied' | 'accepted' | 'rejected' | 'cancelled' | 'expired' | 'completed';

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

type WageRow = {
  id: string;
  worked_minutes: number;
  night_minutes: number;
  base: number;
  night_premium: number;
  gross: number;
  calculated_at: string;
  shifts: {
    shift_date: string;
    start_time: string;
    end_time: string;
    facilities: { name: string } | null;
  } | null;
};

// ── 상수 ───────────────────────────────────────────────────────
const STATUS_CONFIG: Record<ApplicationStatus, { label: string; className: string }> = {
  applied:   { label: '검토 중',  className: 'bg-primary/10 text-primary' },
  accepted:  { label: '수락됨',   className: 'bg-[#E5FAF4] text-success' },
  rejected:  { label: '미선정',   className: 'bg-[#F2F4F6] text-tertiary' },
  cancelled: { label: '취소됨',   className: 'bg-[#F2F4F6] text-tertiary' },
  expired:   { label: '만료',     className: 'bg-[#F2F4F6] text-tertiary' },
  completed: { label: '근무 완료', className: 'bg-[#E5FAF4] text-success' },
};

function fmtMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── 지원 카드 ──────────────────────────────────────────────────
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
  const end   = app.shift.end_time.slice(0, 5);
  const pay   = app.shift.estimated_total_pay.toLocaleString('ko-KR');
  const appliedDate = new Date(app.applied_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

  const today      = new Date().toISOString().slice(0, 10);
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
      <p className="text-[20px] font-extrabold text-ink leading-tight mb-1">
        {start} – {end}{app.shift.is_overnight ? ' (익일)' : ''}
      </p>
      {app.shift.department && (
        <p className="text-[13px] text-tertiary mb-0.5">{app.shift.department}</p>
      )}
      <p className="text-[14px] text-sub line-clamp-2 mb-3">{app.shift.description}</p>

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
            <button
              onClick={() => onQR(app)}
              className="mt-3 w-full h-12 bg-[#E5FAF4] text-success text-[15px] font-bold rounded-xl flex items-center justify-center gap-2 active:opacity-80"
            >
              🔲 QR 체크인
            </button>
          ) : (
            <div className="mt-3 p-3 bg-bg rounded-xl flex items-center gap-2">
              <span className="text-success">✅</span>
              <p className="text-[13px] font-semibold text-sub">
                수락됨{dLabel ? ` · ${dLabel}` : ''}
              </p>
            </div>
          )}
        </>
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

// ── 급여 카드 ──────────────────────────────────────────────────
function WageCard({ wage }: { wage: WageRow }) {
  const shift      = wage.shifts;
  const date       = shift?.shift_date ?? wage.calculated_at.slice(0, 10);
  const facility   = shift?.facilities?.name ?? '병원/클리닉';
  const start      = shift?.start_time?.slice(0, 5) ?? '';
  const end        = shift?.end_time?.slice(0, 5) ?? '';
  const hasNight   = wage.night_premium > 0;

  return (
    <div className="bg-white rounded-card shadow-card p-5 mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-semibold text-sub">{date}</span>
        <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-[#E5FAF4] text-success">
          정산 완료
        </span>
      </div>

      <p className="text-[17px] font-extrabold text-ink">{facility}</p>
      {start && (
        <p className="text-[13px] text-sub mt-0.5">{start} – {end} · {fmtMinutes(wage.worked_minutes)}</p>
      )}

      <div className="mt-3 pt-3 border-t border-line space-y-1.5">
        <div className="flex justify-between text-[13px]">
          <span className="text-sub">기본급</span>
          <span className="font-semibold text-ink">₩{wage.base.toLocaleString('ko-KR')}</span>
        </div>
        {hasNight && (
          <div className="flex justify-between text-[13px]">
            <span className="text-sub">야간수당</span>
            <span className="font-semibold text-ink">₩{wage.night_premium.toLocaleString('ko-KR')}</span>
          </div>
        )}
        <div className="flex justify-between text-[14px] pt-1.5 border-t border-line">
          <span className="font-bold text-ink">합계</span>
          <span className="font-extrabold text-primary text-[16px]">₩{wage.gross.toLocaleString('ko-KR')}</span>
        </div>
      </div>
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────────
type Tab = 'applications' | 'wages';

export default function ApplicationsPage() {
  const [tab, setTab]       = useState<Tab>('applications');
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [apps, setApps]     = useState<Application[]>([]);
  const [wages, setWages]   = useState<WageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [noAuth, setNoAuth] = useState(false);
  const [qrTarget, setQrTarget] = useState<Application | null>(null);

  // 워커 ID + 지원 현황 초기 로드
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

      setWorkerId(worker.id);

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

  // 급여 탭 전환 시 lazy 로드
  useEffect(() => {
    if (tab !== 'wages' || !workerId || wages.length > 0) return;

    async function loadWages() {
      const { data } = await supabase
        .from('wage_calculations')
        .select(`
          id, worked_minutes, night_minutes, base, night_premium, gross, calculated_at,
          shifts (
            shift_date, start_time, end_time,
            facilities ( name )
          )
        `)
        .eq('worker_id', workerId)
        .order('calculated_at', { ascending: false })
        .limit(50);

      setWages((data as unknown as WageRow[]) ?? []);
    }
    loadWages();
  }, [tab, workerId, wages.length]);

  async function handleCancel(applicationId: string) {
    const { error } = await supabase
      .from('shift_applications')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', applicationId);

    if (!error) {
      setApps((prev) => prev.map((a) => a.id === applicationId ? { ...a, status: 'cancelled' as const } : a));
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

  // 이번 달 급여 합계
  const thisMonth  = new Date().toISOString().slice(0, 7);
  const monthGross = wages
    .filter((w) => w.calculated_at.startsWith(thisMonth))
    .reduce((s, w) => s + w.gross, 0);

  return (
    <div className="px-4 pb-10">
      <div className="pt-14 pb-4">
        <h1 className="text-[28px] font-extrabold text-ink">내 활동</h1>
      </div>

      {/* 세그먼트 컨트롤 */}
      <div className="flex bg-bg rounded-2xl p-1 mb-5">
        {(['applications', 'wages'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-xl text-[14px] font-bold transition-all ${
              tab === t ? 'bg-white text-ink shadow-sm' : 'text-sub'
            }`}
          >
            {t === 'applications' ? `지원 현황 ${apps.length > 0 ? `(${apps.length})` : ''}` : '급여 내역'}
          </button>
        ))}
      </div>

      {/* ── 지원 현황 탭 ── */}
      {tab === 'applications' && (
        apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <span className="text-5xl">📋</span>
            <p className="text-[17px] font-bold text-ink">아직 지원한 시프트가 없어요</p>
            <p className="text-[14px] text-sub text-center">마음에 드는 시프트에 지원해 보세요</p>
          </div>
        ) : (
          apps.map((a) => (
            <ApplicationCard key={a.id} app={a} onCancel={handleCancel} onQR={setQrTarget} />
          ))
        )
      )}

      {/* ── 급여 내역 탭 ── */}
      {tab === 'wages' && (
        <>
          {/* 이번 달 합계 카드 */}
          {wages.length > 0 && (
            <div className="bg-primary rounded-2xl p-5 mb-5 flex items-center justify-between">
              <div>
                <p className="text-[13px] text-white/70 font-semibold">이번 달 수령액</p>
                <p className="text-[28px] font-extrabold text-white mt-0.5">
                  ₩{monthGross.toLocaleString('ko-KR')}
                </p>
              </div>
              <div className="text-[40px] opacity-30">💰</div>
            </div>
          )}

          {wages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <span className="text-5xl">💸</span>
              <p className="text-[17px] font-bold text-ink">아직 정산 내역이 없어요</p>
              <p className="text-[14px] text-sub text-center">시프트 체크아웃 완료 후 기록돼요</p>
            </div>
          ) : (
            wages.map((w) => <WageCard key={w.id} wage={w} />)
          )}
        </>
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
