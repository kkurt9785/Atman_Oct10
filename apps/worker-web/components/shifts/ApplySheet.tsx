'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Shift } from '@/app/shifts/page';

type Props = {
  shift: Shift;
  onClose: () => void;
  onApplied: () => void;
};

type ApplyState = 'confirm' | 'loading' | 'success' | 'no_auth' | 'error';

export function ApplySheet({ shift, onClose, onApplied }: Props) {
  const [state, setState] = useState<ApplyState>('confirm');
  const [errorMsg, setErrorMsg] = useState('');

  const pay = shift.estimated_total_pay.toLocaleString('ko-KR');
  const start = shift.start_time.slice(0, 5);
  const end = shift.end_time.slice(0, 5);

  async function handleApply() {
    setState('loading');

    // 1. 세션 확인
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setState('no_auth');
      return;
    }

    // 2. workers 테이블에서 worker_id 조회
    const { data: worker } = await supabase
      .from('workers')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!worker) {
      setState('no_auth');
      return;
    }

    // 3. 이미 지원했는지 확인
    const { data: existing } = await supabase
      .from('shift_applications')
      .select('id')
      .eq('shift_id', shift.id)
      .eq('worker_id', worker.id)
      .maybeSingle();

    if (existing) {
      setErrorMsg('이미 지원한 시프트예요.');
      setState('error');
      return;
    }

    // 4. 지원 등록
    const { error } = await supabase.from('shift_applications').insert({
      shift_id: shift.id,
      worker_id: worker.id,
    });

    if (error) {
      setErrorMsg('지원 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
      setState('error');
      return;
    }

    setState('success');
  }

  return (
    <>
      {/* 딤 배경 */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={state === 'loading' ? undefined : onClose}
      />

      {/* 바텀시트 */}
      <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-[24px] z-50 px-6 pb-10 pt-5">
        {/* 핸들 */}
        <div className="w-10 h-1 bg-line rounded-full mx-auto mb-6" />

        {/* confirm 상태 */}
        {state === 'confirm' && (
          <>
            <h2 className="text-[20px] font-extrabold text-ink mb-1">이 시프트에 지원할까요?</h2>
            <p className="text-[14px] text-sub mb-6">지원 후 시설에서 수락하면 매칭이 완료돼요</p>

            {/* 시프트 요약 */}
            <div className="bg-bg rounded-card p-4 mb-6 flex flex-col gap-2">
              <div className="flex justify-between text-[14px]">
                <span className="text-sub">날짜</span>
                <span className="font-semibold text-ink">{shift.shift_date}</span>
              </div>
              <div className="flex justify-between text-[14px]">
                <span className="text-sub">시간</span>
                <span className="font-semibold text-ink">
                  {start} – {end}{shift.is_overnight ? ' (익일)' : ''}
                </span>
              </div>
              {shift.department && (
                <div className="flex justify-between text-[14px]">
                  <span className="text-sub">부서</span>
                  <span className="font-semibold text-ink">{shift.department}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] pt-2 border-t border-line">
                <span className="text-sub">예상 지급액</span>
                <span className="font-extrabold text-primary text-[16px]">₩{pay}</span>
              </div>
            </div>

            <button
              onClick={handleApply}
              className="w-full h-14 bg-primary text-white text-[17px] font-bold rounded-btn shadow-btn active:opacity-80 mb-3"
            >
              지원하기
            </button>
            <button
              onClick={onClose}
              className="w-full h-12 text-[15px] font-medium text-sub"
            >
              취소
            </button>
          </>
        )}

        {/* 로딩 상태 */}
        {state === 'loading' && (
          <div className="flex flex-col items-center py-10 gap-3">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-[15px] text-sub">지원 중...</p>
          </div>
        )}

        {/* 성공 상태 */}
        {state === 'success' && (
          <div className="flex flex-col items-center py-6 gap-3">
            <div className="w-16 h-16 rounded-full bg-success-light flex items-center justify-center mb-2">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M7 16L13 22L25 10" stroke="#00C896" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-[20px] font-extrabold text-ink">지원 완료!</h2>
            <p className="text-[14px] text-sub text-center">
              시설에서 수락하면 카카오 알림으로<br />알려드릴게요
            </p>
            <button
              onClick={onApplied}
              className="mt-4 w-full h-14 bg-primary text-white text-[17px] font-bold rounded-btn shadow-btn active:opacity-80"
            >
              확인
            </button>
          </div>
        )}

        {/* 로그인 필요 상태 */}
        {state === 'no_auth' && (
          <div className="flex flex-col items-center py-6 gap-3">
            <span className="text-5xl">🔐</span>
            <h2 className="text-[20px] font-extrabold text-ink">로그인이 필요해요</h2>
            <p className="text-[14px] text-sub text-center">
              회원가입 후 지원할 수 있어요
            </p>
            <button
              onClick={onClose}
              className="mt-4 w-full h-14 bg-primary text-white text-[17px] font-bold rounded-btn shadow-btn active:opacity-80"
            >
              확인
            </button>
          </div>
        )}

        {/* 에러 상태 */}
        {state === 'error' && (
          <div className="flex flex-col items-center py-6 gap-3">
            <span className="text-5xl">⚠️</span>
            <h2 className="text-[20px] font-extrabold text-ink">지원 실패</h2>
            <p className="text-[14px] text-sub text-center">{errorMsg}</p>
            <button
              onClick={() => setState('confirm')}
              className="mt-4 w-full h-14 bg-primary text-white text-[17px] font-bold rounded-btn shadow-btn active:opacity-80"
            >
              다시 시도
            </button>
            <button onClick={onClose} className="text-[14px] text-sub py-2">
              닫기
            </button>
          </div>
        )}
      </div>
    </>
  );
}
