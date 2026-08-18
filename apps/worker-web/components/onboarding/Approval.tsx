'use client';

import { Button } from '@/components/ui/Button';
import type { WorkerRole } from '@/lib/roles';

export function Approval({ role,onStart, onBrowse }: { role:WorkerRole|null; onStart: () => void; onBrowse: () => void }) {
  void onStart;
  const isOfficeStaff = role === 'pharmacy_staff';
  const isNursing = role === 'rn' || role === 'na';
  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <div className="flex flex-col items-center mb-8 mt-4">
        <div className="w-24 h-24 rounded-full bg-success-light flex items-center justify-center mb-6">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <path d="M10 24L20 34L38 14" stroke="#00C896" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-[28px] font-bold text-ink letter-tight mb-2 text-center">가입이 완료됐어요!</h1>
        <p className="text-[16px] text-sub text-center break-keep">
          {isNursing
            ? '바로 근무를 둘러보고 지원할 수 있어요. 채용 확정 전 사업장이 자격을 확인합니다.'
            : isOfficeStaff
            ? '나의 정보에서 경력과 최근 근무지를 입력하면 바로 활동 승인이 완료돼요.'
            : '나의 정보에서 면허를 등록하면 심사 후 시프트에 지원할 수 있어요.'}
        </p>
      </div>

      <div className="bg-white rounded-card shadow-card p-5 mb-6">
        <p className="text-[17px] font-bold text-ink mb-3">시작하기 전에 확인해 주세요</p>
        <ul className="space-y-3 text-[14px] text-sub">
          <li className="flex gap-2"><span aria-hidden="true">✓</span><span>{isNursing?'면허 사진은 선택 사항이며, 채용 확정 전 사업장이 면접 등에서 자격을 확인해요.':role==='pharmacy_staff'?'경력과 활동지역은 지원한 약국 담당자가 검토할 때 참고할 수 있어요.':'면허·자격 서류 상태는 지원한 사업장이 검토할 때 참고할 수 있어요.'}</span></li>
          <li className="flex gap-2"><span aria-hidden="true">✓</span><span>근무 전 시프트 시간, 위치, 급여 조건을 다시 확인해 주세요.</span></li>
          <li className="flex gap-2"><span aria-hidden="true">✓</span><span>근무 당일에는 GPS 원터치 출퇴근을 우선 사용하고 필요할 때 60초 QR로 인증해요.</span></li>
        </ul>
      </div>

      <div className="mt-auto flex flex-col gap-3">
        {isNursing ? <Button onClick={onBrowse}>근무 둘러보기</Button> : <Button href="/settings/profile">{isOfficeStaff ? '프로필 완성하고 승인받기' : '면허 등록하러 가기'}</Button>}
        {!isNursing && <button onClick={onBrowse} className="text-[15px] font-medium text-sub text-center py-2">홈으로 이동</button>}
      </div>
    </div>
  );
}
