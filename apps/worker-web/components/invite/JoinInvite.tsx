'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { rememberWorkerShell } from '@/lib/worker-mode';

// 근무 초대 수락 화면. 긱워커(/gig/join)와 사업장 직원(/workplace/join) 두 라우트가 같은 흐름
// (미리보기 → 카카오 가입 → claim)을 쓰되, 초대가 어느 제품 것인지는 서버(isGigworker)가 정한다.
// 라우트와 초대 종류가 어긋나면 맞는 라우트로 보낸다 — 이미 발송된 옛 링크가 계속 동작해야 한다.

export type JoinVariant = 'gig' | 'medical';

type InvitePreview = {
  ok: boolean;
  message?: string;
  isGigworker?: boolean;
  facilityName?: string;
  facilityAddress?: string | null;
  workerName?: string;
  role?: string | null;
  workDescription?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  workWeekdays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number | null;
  payBasis?: string | null;
  payRate?: number | null;
  payHidden?: boolean;
  phoneLast4?: string;
  expiresAt?: string;
};

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const PAY_BASIS: Record<string, string> = { hourly: '시급', daily: '일급', monthly: '월급' };
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;
const ROUTES: Record<JoinVariant, { join: string; home: string; settings: string }> = {
  gig: { join: '/gig/join', home: '/gig', settings: '/gig/settings' },
  medical: { join: '/workplace/join', home: '/workplace', settings: '/settings' },
};

function dateRange(preview: InvitePreview) {
  if (!preview.contractStart && !preview.contractEnd) return '기간 협의';
  if (preview.contractStart === preview.contractEnd) return preview.contractStart ?? '기간 협의';
  return `${preview.contractStart ?? '시작일 협의'} ~ ${preview.contractEnd ?? '종료일 협의'}`;
}

function weekdayText(days?: number[] | null) {
  return (days ?? []).filter((day) => day >= 1 && day <= 7).map((day) => WEEKDAYS[day - 1]).join('·') || '요일 협의';
}

function friendlyInviteError(message: string) {
  return message
    .replace(/^.*?: /, '')
    .replace('병원이 등록한 연락처', '관리자가 등록한 연락처')
    .replace('이 병원의 다른 직원 정보', '이 근무지의 다른 근무자 정보')
    .replace('병원에 재발급', '관리자에게 재발급');
}

export function JoinInvite({ variant }: { variant: JoinVariant }) {
  const params = useSearchParams();
  const token = params.get('token');
  const routes = ROUTES[variant];
  const isGig = variant === 'gig';
  const [status, setStatus] = useState<'loading' | 'preview' | 'claiming' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('근무 초대를 확인하고 있어요...');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [hasWorker, setHasWorker] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!token) {
        setStatus('error');
        setMessage('초대 링크가 올바르지 않아요. 관리자에게 새 링크를 요청해 주세요.');
        return;
      }

      const [{ data: previewData, error: previewError }, { data: { user } }] = await Promise.all([
        supabase.rpc('get_facility_staff_invite_preview', { p_token: token }),
        supabase.auth.getUser(),
      ]);
      if (!active) return;

      const invite = previewData as InvitePreview | null;
      if (previewError || !invite?.ok) {
        setStatus('error');
        setMessage(invite?.message ?? '초대 정보를 불러오지 못했어요. 관리자에게 새 링크를 요청해 주세요.');
        return;
      }

      // 초대 종류와 라우트가 다르면 맞는 쪽으로 — 긱워커 초대는 /gig 셸, 사업장 직원 초대는 의료 워커 셸에서 수락한다.
      const expected = invite.isGigworker ? 'gig' : 'medical';
      if (expected !== variant) {
        window.location.replace(`${ROUTES[expected].join}?token=${encodeURIComponent(token)}`);
        return;
      }

      let workerExists = false;
      if (user) {
        const { data: worker } = await supabase.from('workers').select('id').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle();
        workerExists = Boolean(worker?.id);
      }
      if (!active) return;
      setPreview(invite);
      // 초대를 연 셸을 기억한다 — 가입·수락 뒤 앱을 다시 열면 이 셸로 온다
      rememberWorkerShell(variant);
      setSignedIn(Boolean(user));
      setHasWorker(workerExists);
      setStatus('preview');
      setMessage('아래 근무 조건을 확인한 뒤 초대를 수락해 주세요. 전화번호나 카카오 친구 추가는 필요 없어요.');
    })();
    return () => { active = false; };
  }, [token, variant, isGig]);

  function startRegistration() {
    if (!token) return;
    rememberWorkerShell(variant);
    window.localStorage.setItem('atman_auth_next', `${routes.join}?token=${encodeURIComponent(token)}`);
    window.location.href = signedIn ? '/onboarding?step=terms' : '/onboarding';
  }

  async function claimInvite() {
    if (!token || status === 'claiming') return;
    if (!signedIn || !hasWorker) {
      startRegistration();
      return;
    }
    setStatus('claiming');
    setMessage('근무 초대를 연결하고 있어요...');
    const { error } = await supabase.rpc('claim_facility_staff_invite', { p_token: token });
    if (error) {
      setStatus('error');
      setMessage(friendlyInviteError(error.message));
      return;
    }
    rememberWorkerShell(variant);
    window.dispatchEvent(new Event('atman:workplace-linked'));
    setStatus('success');
    setMessage(`${preview?.facilityName ?? '근무지'} 계정과 워크룸 연결이 완료됐어요.`);
  }

  const payText = preview?.payBasis && preview.payRate
    ? `${PAY_BASIS[preview.payBasis] ?? preview.payBasis} ${won(preview.payRate)}`
    : null;

  return <main className={`min-h-screen px-5 pb-16 pt-8 ${isGig ? 'bg-gradient-to-b from-primary/15 via-bg to-bg' : 'bg-bg'}`}>
    <div className="mx-auto mb-5 flex max-w-md items-center justify-between px-1"><p className="text-[20px] font-extrabold tracking-[-0.5px] text-primary">잇닿 <span className="text-ink">{isGig ? 'GIG' : 'WORKER'}</span></p>{isGig && <span className="rounded-full bg-ink px-3 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white">WORK INVITE</span>}</div>
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-card">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${status === 'success' ? 'bg-emerald-50 text-emerald-600' : status === 'error' ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'}`}>{status === 'success' ? '✓' : status === 'error' ? '!' : '↗'}</div>
      <p className="mt-5 text-[13px] font-bold text-primary">{isGig ? '긱워커 전용 근태 초대' : '직원 계정 연결'}</p>
      <h1 className="mt-1 text-[24px] font-extrabold">{status === 'success' ? '이제 앱에서 함께 일해요' : '초대받은 근무를 확인해 주세요'}</h1>
      <p role="status" className="mt-3 text-[14px] leading-6 text-sub">{message}</p>

      {preview && status !== 'success' && <div className="mt-5 overflow-hidden rounded-2xl border border-line">
        <div className="bg-primary/5 px-4 py-4">
          <p className="text-[18px] font-extrabold text-ink">{preview.facilityName}</p>
          {preview.facilityAddress && <p className="mt-1 text-[12px] leading-5 text-sub">{preview.facilityAddress}</p>}
        </div>
        <dl className="divide-y divide-line px-4 text-[13px]">
          <div className="flex justify-between gap-4 py-3"><dt className="shrink-0 text-sub">등록 이름</dt><dd className="text-right font-bold text-ink">{preview.workerName}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="shrink-0 text-sub">근무 기간</dt><dd className="text-right font-bold text-ink">{dateRange(preview)}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="shrink-0 text-sub">근무 일정</dt><dd className="text-right font-bold text-ink">{weekdayText(preview.workWeekdays)} · {preview.startTime?.slice(0, 5) ?? '시간 협의'}~{preview.endTime?.slice(0, 5) ?? ''}</dd></div>
          {preview.workDescription && <div className="flex justify-between gap-4 py-3"><dt className="shrink-0 text-sub">업무</dt><dd className="text-right font-bold text-ink">{preview.workDescription}</dd></div>}
          {payText && <div className="flex justify-between gap-4 py-3"><dt className="shrink-0 text-sub">급여 조건</dt><dd className="text-right font-bold text-ink">{payText}</dd></div>}
          {!payText && preview.payHidden && <div className="flex justify-between gap-4 py-3"><dt className="shrink-0 text-sub">급여 조건</dt><dd className="text-right text-[12px] text-sub">로그인하면 확인할 수 있어요</dd></div>}
          {preview.phoneLast4 && <div className="flex justify-between gap-4 py-3"><dt className="shrink-0 text-sub">선택 연락처</dt><dd className="text-right font-bold text-ink">휴대폰 끝 4자리 {preview.phoneLast4}</dd></div>}
        </dl>
      </div>}

      {status === 'preview' && preview && <>
        <button type="button" onClick={() => void claimInvite()} className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">
          {!signedIn ? '카카오로 가입하고 참여하기' : !hasWorker ? '인적사항 등록하고 참여하기' : '초대 수락하고 워크룸 참여하기'}
        </button>
        <p className="mt-3 text-center text-[11px] leading-5 text-sub">이 일회용 링크가 본인 확인 수단이에요. 가입 후 공지·근무 대화·출퇴근 기록은 앱 안에 계속 남습니다.</p>
      </>}
      {status === 'claiming' && <button disabled className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white opacity-60">연결 중...</button>}
      {status === 'success' && <><Link href={isGig?'/gig/workroom':'/workroom'} className="mt-6 flex h-12 items-center justify-center rounded-xl bg-primary font-bold text-white">사업장 워크룸 열기</Link><Link href={routes.home} className="mt-2 flex h-11 items-center justify-center rounded-xl text-[13px] font-bold text-sub">오늘 근무 확인하기</Link></>}
      {status === 'error' && <p className="mt-5 rounded-xl bg-bg p-3 text-[12px] leading-5 text-sub">링크가 만료됐거나 이미 사용됐다면 근무지 관리자에게 새 초대 링크나 QR을 요청해 주세요.</p>}
    </section>
  </main>;
}
