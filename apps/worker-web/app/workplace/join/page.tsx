'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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
  phoneLast4?: string;
  expiresAt?: string;
};

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const PAY_BASIS: Record<string, string> = { hourly: '시급', daily: '일급', monthly: '월급' };
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

function dateRange(preview: InvitePreview) {
  if (!preview.contractStart && !preview.contractEnd) return '기간 협의';
  if (preview.contractStart === preview.contractEnd) return preview.contractStart ?? '기간 협의';
  return `${preview.contractStart ?? '시작일 협의'} ~ ${preview.contractEnd ?? '종료일 협의'}`;
}

function weekdayText(days?: number[] | null) {
  return (days ?? []).filter((day) => day >= 1 && day <= 7).map((day) => WEEKDAYS[day - 1]).join('·') || '요일 협의';
}

function JoinWorkplaceContent() {
  const params = useSearchParams();
  const token = params.get('token');
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

      let workerExists = false;
      if (user) {
        const { data: worker } = await supabase.from('workers').select('id').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle();
        workerExists = Boolean(worker?.id);
      }
      if (!active) return;
      setPreview(invite);
      setSignedIn(Boolean(user));
      setHasWorker(workerExists);
      setStatus('preview');
      setMessage('아래 근무 조건과 등록된 연락처를 확인한 뒤 초대를 수락해 주세요.');
    })();
    return () => { active = false; };
  }, [token]);

  function startRegistration() {
    if (!token) return;
    window.localStorage.setItem('atman_auth_next', `/workplace/join?token=${encodeURIComponent(token)}`);
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
      setMessage(error.message.replace(/^.*?: /, '').replace('병원에 재발급', '관리자에게 재발급'));
      return;
    }
    if (preview?.isGigworker) window.localStorage.setItem('atman_gigworker_mode', '1');
    window.dispatchEvent(new Event('atman:workplace-linked'));
    setStatus('success');
    setMessage(`${preview?.facilityName ?? '근무지'} 근태 연결이 완료됐어요.`);
  }

  const payText = preview?.payBasis && preview.payRate
    ? `${PAY_BASIS[preview.payBasis] ?? preview.payBasis} ${won(preview.payRate)}`
    : null;

  return <main className="min-h-screen bg-bg px-5 pb-24 pt-10">
    <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${status === 'success' ? 'bg-emerald-50 text-emerald-600' : status === 'error' ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'}`}>{status === 'success' ? '✓' : status === 'error' ? '!' : '↗'}</div>
      <p className="mt-5 text-[13px] font-bold text-primary">{preview?.isGigworker ? '긱워커 근태 초대' : '직원 계정 연결'}</p>
      <h1 className="mt-1 text-[24px] font-extrabold">{status === 'success' ? '연결 완료' : '근무 초대를 확인해 주세요'}</h1>
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
          <div className="flex justify-between gap-4 py-3"><dt className="shrink-0 text-sub">등록 연락처</dt><dd className="text-right font-bold text-ink">휴대폰 끝 4자리 {preview.phoneLast4}</dd></div>
        </dl>
      </div>}

      {status === 'preview' && preview && <>
        <button type="button" onClick={() => void claimInvite()} className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white">
          {!signedIn ? '카카오로 가입하고 수락하기' : !hasWorker ? '근무자 정보 등록하고 수락하기' : '초대 수락하고 근태 시작하기'}
        </button>
        <p className="mt-3 text-center text-[11px] leading-5 text-sub">가입할 휴대폰 번호는 관리자가 등록한 번호 끝 4자리 {preview.phoneLast4}와 같아야 해요.</p>
      </>}
      {status === 'claiming' && <button disabled className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-bold text-white opacity-60">연결 중...</button>}
      {status === 'success' && <><Link href="/workplace" className="mt-6 flex h-12 items-center justify-center rounded-xl bg-primary font-bold text-white">오늘 근무 확인하기</Link><Link href="/settings" className="mt-2 flex h-11 items-center justify-center rounded-xl text-[13px] font-bold text-sub">출근 알림 설정하기</Link></>}
      {status === 'error' && <p className="mt-5 rounded-xl bg-bg p-3 text-[12px] leading-5 text-sub">연락처가 다르거나 링크가 만료됐다면 근무지 관리자에게 새 초대를 요청해 주세요.</p>}
    </section>
  </main>;
}

export default function JoinWorkplacePage() {
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">초대를 확인하고 있어요...</main>}><JoinWorkplaceContent /></Suspense>;
}
