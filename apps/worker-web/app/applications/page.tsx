'use client';

import { useEffect, useState } from 'react';
import { BankNudge } from '@/components/settings/BankAccountRow';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dateKST } from '@/lib/date';
import { cancelApplication, respondToInvitation } from '@/lib/shifts';
import { cancelCover, listMyCovers, requestCover, type MyCover } from '@/lib/cover';
import { facilityName, mobilityLabel, timeLabel } from '@/lib/shift-display';
import { AttendanceActionButton, type AttendanceResult } from '@/components/attendance/AttendanceActionButton';

// ── 타입 ───────────────────────────────────────────────────────
type ApplicationStatus = 'invited' | 'applied' | 'accepted' | 'rejected' | 'cancelled' | 'expired' | 'completed';
type ActivityFilter = 'active' | 'accepted' | 'completed' | 'all';

type Application = {
  id: string;
  status: ApplicationStatus;
  confirm_on_accept?: boolean;
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
    status?: string;
    department: string | null;
    description: string;
    facilities?: { name: string; address_text: string } | Array<{ name: string; address_text: string }> | null;
  };
};

// ── 상수 ───────────────────────────────────────────────────────
const VACANCY_STATUS: Partial<Record<ApplicationStatus, { label: string; description: string; className: string }>> = {
  invited: { label: '근무 요청', description: '사업장에서 이 근무를 맡아 줄 수 있는지 물어봤어요. 먼저 수락한 분으로 바로 확정돼요.', className: 'bg-amber-100 text-amber-700' },
  expired: { label: '마감', description: '다른 분이 먼저 맡았어요.', className: 'bg-[#F2F4F6] text-tertiary' },
  cancelled: { label: '거절함', description: '이번 요청은 거절했어요.', className: 'bg-[#F2F4F6] text-tertiary' },
};
const STATUS_CONFIG: Record<ApplicationStatus, { label: string; description: string; className: string }> = {
  invited: {
    label: '반복근무 요청',
    description: '이전에 함께한 사업장에서 다시 근무를 요청했어요. 수락 여부를 선택해 주세요.',
    className: 'bg-amber-100 text-amber-700',
  },
  applied: {
    label: '사업장 확인 중',
    description: '지원이 접수됐고 사업장에서 확인하고 있어요.',
    className: 'bg-primary/10 text-primary',
  },
  accepted: {
    label: '채용 확정',
    description: '사업장이 수락했어요. 근무 당일 원터치 출근을 준비해 주세요.',
    className: 'bg-[#E5FAF4] text-success',
  },
  rejected: {
    label: '미선정',
    description: '이번 근무는 다른 지원자가 선정됐어요.',
    className: 'bg-[#F2F4F6] text-tertiary',
  },
  cancelled: {
    label: '취소됨',
    description: '지원이 취소됐어요.',
    className: 'bg-[#F2F4F6] text-tertiary',
  },
  expired: {
    label: '만료',
    description: '근무 시간이 지나 지원이 만료됐어요.',
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

// ── 대타 요청 ──────────────────────────────────────────────────
// 확정된 근무에 못 나오게 됐을 때의 유일한 출구. 예전엔 확정 후 취소 수단이 없어 전화 아니면 노쇼였다.
// 요청만 해두고 이미 빠진 줄 알면 오히려 노쇼가 생기므로, 승인 전까지는 내 근무라는 걸 매번 보여준다.
function CoverPanel({
  app,
  cover,
  onRequest,
  onCancel,
}: {
  app: Application;
  cover?: MyCover;
  onRequest: (applicationId: string, reason: string) => Promise<boolean>;
  onCancel: (coverId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (cover && (cover.status === 'open' || cover.status === 'claimed')) {
    const claimed = cover.status === 'claimed';
    return (
      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-[13px] font-extrabold text-ink">
          {claimed ? `${cover.claimer_name ?? '동료'}님이 맡겠다고 했어요 · 사업장 승인 대기` : '대타 구하는 중'}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-sub">
          {claimed ? '사업장이 승인하면 확정 알림이 와요.' : '함께 일한 동료·인력풀에 알렸어요.'}{' '}
          <b className="text-ink">승인되기 전까지는 내 근무예요.</b>
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); await onCancel(cover.id); setBusy(false); }}
          className="mt-2 text-[12px] font-bold text-sub underline disabled:opacity-50"
        >
          대타 요청 취소하고 직접 나갈게요
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full h-11 rounded-btn border border-line text-[14px] font-semibold text-sub active:bg-bg"
      >
        못 가게 됐어요 · 대타 구하기
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-line bg-bg p-3">
      <p className="text-[13px] font-extrabold text-ink">이 근무의 대타를 구할게요</p>
      <ul className="mt-1.5 space-y-0.5 text-[12px] leading-5 text-sub">
        <li>· 이 사업장에서 함께 일한 같은 직군에게 알림이 가요</li>
        <li>· 누군가 맡으면 사업장이 승인해야 확정돼요</li>
        <li>· <b className="text-ink">승인되기 전까지는 내 근무예요</b></li>
      </ul>
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value.slice(0, 200))}
        rows={2}
        placeholder="사유 (선택) — 사업장에만 전달되고 동료에게는 보이지 않아요"
        className="mt-2 w-full resize-none rounded-xl bg-white px-3 py-2 text-[13px] text-ink placeholder:text-tertiary"
      />
      <div className="mt-2 grid grid-cols-[1fr_2fr] gap-2">
        <button type="button" onClick={() => { setOpen(false); setReason(''); }} className="h-11 rounded-btn border border-line bg-white text-[13px] font-bold text-sub">닫기</button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => { setBusy(true); const ok = await onRequest(app.id, reason.trim()); setBusy(false); if (ok) { setOpen(false); setReason(''); } }}
          className="h-11 rounded-btn bg-ink text-[13px] font-extrabold text-white disabled:opacity-50"
        >
          {busy ? '보내는 중…' : '대타 구하기'}
        </button>
      </div>
    </div>
  );
}

// ── 지원 카드 ──────────────────────────────────────────────────
function ApplicationCard({
  app,
  cover,
  onCancel,
  onInvitation,
  onAttendanceSuccess,
  onRequestCover,
  onCancelCover,
}: {
  app: Application;
  cover?: MyCover;
  onCancel: (id: string) => void;
  onInvitation: (id: string, accept: boolean) => void;
  onAttendanceSuccess: (id: string, action: 'check_in' | 'check_out', response?: AttendanceResult) => void;
  onRequestCover: (applicationId: string, reason: string) => Promise<boolean>;
  onCancelCover: (coverId: string) => Promise<void>;
}) {
  // 대타가 승인돼 빠진 근무는 '취소됨'이 아니다 — 본인이 취소한 것처럼 보이면 책임 있게 대타를 구한 행동이 묻힌다
  const coveredByOther = app.status === 'cancelled' && cover?.status === 'approved';
  // 결원 요청(먼저 수락한 분으로 바로 확정)은 반복근무 요청과 안내가 다르다
  const vacancyCopy = app.confirm_on_accept ? VACANCY_STATUS[app.status] : undefined;
  // 사업장이 근무를 취소했으면 요청·지원 상태와 상관없이 그렇게 보여 준다(수락 버튼도 숨김)
  const shiftCancelled = app.shift.status === 'cancelled' && !['completed', 'accepted'].includes(app.status);
  const { label, description, className } = coveredByOther
    ? { label: '대타 확정', description: `${cover?.claimer_name ?? '동료'}님이 이 근무를 맡았어요. 빠지셔도 돼요.`, className: 'bg-[#E5FAF4] text-success' }
    : shiftCancelled
      ? { label: '근무 취소', description: '사업장 사정으로 근무가 취소됐어요.', className: 'bg-[#F2F4F6] text-tertiary' }
      : vacancyCopy ?? STATUS_CONFIG[app.status];
  const startsAt = Date.parse(`${app.shift.shift_date}T${app.shift.start_time.slice(0, 5)}:00+09:00`);
  const canSeekCover = app.status === 'accepted' && !app.checked_in_at && !app.checked_out_at && startsAt > Date.now();
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

      {app.status === 'invited' && !shiftCancelled && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={() => onInvitation(app.id, false)} className="h-12 rounded-xl border border-line text-[14px] font-bold text-sub">이번에는 어려워요</button>
          <button onClick={() => onInvitation(app.id, true)} className="h-12 rounded-xl bg-primary text-white text-[14px] font-extrabold">{app.confirm_on_accept ? '맡을게요 · 바로 확정' : '근무 요청 수락'}</button>
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
              </div>
              <AttendanceActionButton targetType="shift" targetId={app.id} action="check_out" onSuccess={(response) => onAttendanceSuccess(app.id, 'check_out', response)}/>
            </div>
          ) : isToday ? (
            <AttendanceActionButton targetType="shift" targetId={app.id} action="check_in" onSuccess={(response) => onAttendanceSuccess(app.id, 'check_in', response)}/>
          ) : (
            <div className="mt-3 p-3 bg-bg rounded-xl flex items-center gap-2">
              <span className="text-success">✅</span>
              <p className="text-[13px] font-semibold text-sub">
                수락됨{dLabel ? ` · ${dLabel}` : ''}
              </p>
            </div>
          )}
          {canSeekCover && <CoverPanel app={app} cover={cover} onRequest={onRequestCover} onCancel={onCancelCover} />}
          <Link
            href={`/chat/${app.id}`}
            className="mt-2 w-full h-11 border border-primary/30 rounded-btn text-[14px] font-semibold text-primary flex items-center justify-center gap-1.5 active:bg-primary/5"
          >
            💬 사업장 채팅
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

      {app.status === 'applied' && !shiftCancelled && (
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
  const [actionNotice, setActionNotice] = useState('');
  const [activityFilter,setActivityFilter]=useState<ActivityFilter>('active');
  const [covers, setCovers] = useState<MyCover[]>([]);

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

      void listMyCovers().then(setCovers);
      const { data } = await supabase
        .from('shift_applications')
        .select(`
          id, status, confirm_on_accept, applied_at, checked_in_at, checked_out_at,
          shift:shifts (
            id, shift_date, start_time, end_time, is_overnight, status,
            estimated_total_pay, department, description,
            facilities ( name, address_text )
          )
        `)
        .eq('worker_id', worker.id)
        .order('applied_at', { ascending: false });

      const loadedApps=(data as unknown as Application[]) ?? [];
      setApps(loadedApps);
      setActivityFilter(loadedApps.some(app=>['invited','applied'].includes(app.status))?'active':loadedApps.some(app=>app.status==='accepted')?'accepted':loadedApps.some(app=>app.status==='completed')?'completed':'all');
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
    const result = await respondToInvitation(applicationId, accept);
    if (!result.ok) { setActionNotice(result.message ?? '요청 상태를 변경하지 못했어요. 다시 시도해 주세요.'); return; }
    setApps((prev) => prev.map((app) => app.id === applicationId
      ? { ...app, status: accept ? (app.confirm_on_accept ? 'accepted' as const : 'applied' as const) : 'cancelled' as const }
      : app));
    if (accept) setActionNotice(apps.find((app) => app.id === applicationId)?.confirm_on_accept ? '근무가 확정됐어요. 근무 당일 출근하기를 눌러 주세요.' : '');
  }

  async function handleRequestCover(applicationId: string, reason: string): Promise<boolean> {
    const result = await requestCover(applicationId, reason);
    if (!result.ok) { setActionNotice(result.message); return false; }
    setActionNotice('');
    setCovers(await listMyCovers());
    return true;
  }

  async function handleCancelCover(coverId: string): Promise<void> {
    const result = await cancelCover(coverId);
    if (!result.ok) { setActionNotice(result.message); return; }
    setCovers(await listMyCovers());
  }

  // 한 근무에 대타 기록이 여러 개일 수 있다(취소 후 재요청). 진행 중 > 승인 > 그 외 순으로 하나만 보여준다.
  const COVER_RANK: Record<string, number> = { open: 3, claimed: 3, approved: 2 };
  const coverByApp = new Map<string, MyCover>();
  for (const cover of covers) {
    const current = coverByApp.get(cover.application_id);
    if (!current || (COVER_RANK[cover.status] ?? 0) > (COVER_RANK[current.status] ?? 0)) coverByApp.set(cover.application_id, cover);
  }

  function handleAttendanceSuccess(applicationId: string, action: 'check_in' | 'check_out', response?: {status?:'approved'|'pending';checkInAt?:string;checkOutAt?:string}) {
    const now = new Date().toISOString();
    setApps((current) => current.map((app) => app.id !== applicationId ? app : action === 'check_in'
      ? { ...app, checked_in_at: response?.checkInAt??now }
      : response?.status==='pending' ? app : { ...app, checked_out_at: response?.checkOutAt??now, status: 'completed' as const }));
  }
  const activityCounts={
    active:apps.filter(app=>['invited','applied'].includes(app.status)).length,
    accepted:apps.filter(app=>app.status==='accepted').length,
    completed:apps.filter(app=>app.status==='completed').length,
  };
  const visibleApps=activityFilter==='all'?apps:apps.filter(app=>activityFilter==='active'?['invited','applied'].includes(app.status):app.status===activityFilter);

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
        <h1 className="text-[28px] font-extrabold text-ink">내 근무</h1>
      </div>

      <div className="flex items-center justify-between mb-5">
        <p className="text-[14px] font-bold text-ink">지원 현황 {apps.length > 0 ? `(${apps.length})` : ''}</p>
        <button onClick={() => router.push('/earnings')} className="text-[13px] font-bold text-primary bg-primary/8 px-3 py-2 rounded-xl">
          급여 지급현황 →
        </button>
      </div>

      <BankNudge show={apps.some((app) => app.status === 'accepted' || app.status === 'completed')} />

      {apps.length>0&&<div className="mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-white p-1.5 shadow-sm">
        {([['active','진행 중',activityCounts.active],['accepted','확정 근무',activityCounts.accepted],['completed','완료',activityCounts.completed],['all','전체',apps.length]] as const).map(([key,label,count])=><button key={key} type="button" onClick={()=>setActivityFilter(key)} className={`h-10 shrink-0 rounded-xl px-3 text-[12px] font-extrabold ${activityFilter===key?'bg-ink text-white':'text-sub'}`}>{label} {count}</button>)}
      </div>}

      {actionNotice && (
        <p role="alert" className="mb-3 rounded-xl bg-amber-50 text-amber-700 text-[13px] font-bold px-3 py-2">{actionNotice}</p>
      )}

      {apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <span className="text-5xl">📋</span>
            <p className="text-[17px] font-bold text-ink">아직 지원한 공고가 없어요</p>
            <p className="text-[14px] text-sub text-center">마음에 드는 공고에 지원해 보세요</p>
          </div>
        ) : visibleApps.length===0?<div className="rounded-2xl bg-white py-12 text-center"><p className="text-[15px] font-bold text-ink">이 상태의 근무가 없어요</p><button type="button" onClick={()=>setActivityFilter('all')} className="mt-2 text-[13px] font-bold text-primary">전체 내역 보기</button></div> : (
          visibleApps.map((a) => (
            <ApplicationCard key={a.id} app={a} cover={coverByApp.get(a.id)} onCancel={handleCancel} onInvitation={handleInvitation} onAttendanceSuccess={handleAttendanceSuccess} onRequestCover={handleRequestCover} onCancelCover={handleCancelCover} />
          ))
        )}

    </div>
  );
}
