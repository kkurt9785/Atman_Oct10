'use client';

import { useState } from 'react';
import type { Shift } from '@/app/shifts/page';
import { applyToShift } from '@/lib/shifts';
import { facilityName, facilityOf, mobilityLabel, timeLabel } from '@/lib/shift-display';

type Props = {
  shift: Shift;
  onClose: () => void;
  onApplied: () => void;
};

type ApplyState = 'confirm' | 'loading' | 'success' | 'no_auth' | 'no_worker' | 'error';

export function ApplySheet({ shift, onClose, onApplied }: Props) {
  const [state, setState] = useState<ApplyState>('confirm');
  const [errorMsg, setErrorMsg] = useState('');

  const pay = shift.estimated_total_pay.toLocaleString('ko-KR');
  const hourlyWage = shift.hourly_wage.toLocaleString('ko-KR');
  const facility = facilityOf(shift);

  async function handleApply() {
    setState('loading');

    const result = await applyToShift(shift.id);
    if (result.ok) {
      setState('success');
      return;
    }

    if (result.reason === 'auth') { setState('no_auth'); return; }
    if (result.reason === 'worker') { setState('no_worker'); return; }

    setErrorMsg(result.message);
    setState('error');
  }

  return (
    <>
      {/* 딤 배경 */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={state === 'loading' ? undefined : onClose}
      />

      {/* 바텀시트 */}
      <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-[24px] z-50 px-6 pt-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        {/* 핸들 */}
        <div className="w-10 h-1 bg-line rounded-full mx-auto mb-6" />

        {/* confirm 상태 */}
        {state === 'confirm' && (
          <>
            <h2 className="text-[20px] font-extrabold text-ink mb-1">이 시프트에 지원할까요?</h2>
            <p className="text-[14px] text-sub mb-6">내가 선택한 공고에 지원하면 병원이 직접 검토해요</p>

            {/* 시프트 요약 */}
            <div className="bg-bg rounded-card p-4 mb-4">
              <p className="text-[17px] font-extrabold text-ink truncate">{facilityName(shift)}</p>
              {facility?.address_text && (
                <p className="text-[13px] text-sub mt-1 line-clamp-2">{facility.address_text}</p>
              )}
              <p className="text-[13px] font-semibold text-primary mt-2">{mobilityLabel(shift)}</p>
            </div>

            <div className="bg-bg rounded-card p-4 mb-4 flex flex-col gap-2">
              <div className="flex justify-between text-[14px]">
                <span className="text-sub">날짜</span>
                <span className="font-semibold text-ink">{shift.shift_date}</span>
              </div>
              <div className="flex justify-between text-[14px]">
                <span className="text-sub">시간</span>
                <span className="font-semibold text-ink">{timeLabel(shift)}</span>
              </div>
              {shift.department && (
                <div className="flex justify-between text-[14px]">
                  <span className="text-sub">부서</span>
                  <span className="font-semibold text-ink">{shift.department}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px]">
                <span className="text-sub">시급</span>
                <span className="font-semibold text-ink">₩{hourlyWage}</span>
              </div>
              <div className="flex justify-between text-[14px] pt-2 border-t border-line">
                <span className="text-sub">예상 지급액</span>
                <span className="font-extrabold text-primary text-[16px]">₩{pay}</span>
              </div>
            </div>

            <div className="bg-white border border-line rounded-card p-4 mb-6">
              <p className="text-[13px] font-extrabold text-ink mb-2">지원 전 확인</p>
              <div className="flex flex-col gap-1.5 text-[13px] text-sub">
                <p>병원이 수락하면 병원 채용확정 상태로 바뀝니다.</p>
                <p>채용확정 후 당일 취소는 병원과 먼저 확인해 주세요.</p>
                {shift.notes && <p className="text-ink font-semibold">{shift.notes}</p>}
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
              지금은 병원 확인 중이에요.<br />수락되면 병원 채용확정 알림을 보내드릴게요
            </p>
            <button
              onClick={onApplied}
              className="mt-4 w-full h-14 bg-primary text-white text-[17px] font-bold rounded-btn shadow-btn active:opacity-80"
            >
              확인
            </button>
          </div>
        )}

        {/* 미로그인 */}
        {state === 'no_auth' && (
          <div className="flex flex-col items-center py-6 gap-3">
            <span className="text-5xl">🔐</span>
            <h2 className="text-[20px] font-extrabold text-ink">로그인이 필요해요</h2>
            <p className="text-[14px] text-sub text-center">
              시프트는 먼저 둘러볼 수 있고,<br />프로필 승인 후 지원할 수 있어요
            </p>
            <button
              onClick={() => { window.location.href = '/onboarding?step=splash'; }}
              className="mt-4 w-full h-14 bg-primary text-white text-[17px] font-bold rounded-btn shadow-btn active:opacity-80"
            >
              카카오로 1분 가입하기
            </button>
            <button onClick={onClose} className="text-[14px] text-sub py-2">계속 둘러보기</button>
          </div>
        )}

        {/* 로그인은 됐지만 워커 등록/승인 미완료 */}
        {state === 'no_worker' && (
          <div className="flex flex-col items-center py-6 gap-3">
            <span className="text-5xl">📋</span>
            <h2 className="text-[20px] font-extrabold text-ink">프로필 승인 후 지원 가능해요</h2>
            <p className="text-[14px] text-sub text-center">
              자격증과 신원 정보를 등록하면<br />검토 후 지원할 수 있어요
            </p>
            <button
              onClick={() => { window.location.href = '/onboarding'; }}
              className="mt-4 w-full h-14 bg-primary text-white text-[17px] font-bold rounded-btn shadow-btn active:opacity-80"
            >
              프로필 등록하기
            </button>
            <button onClick={onClose} className="text-[14px] text-sub py-2">계속 둘러보기</button>
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
