'use client';
import { useState, useTransition } from 'react';
import { closeFacilityAction, withdrawAdminAccountAction } from '@/lib/actions/account';
import { supabase } from '@/lib/supabase-browser';

const REASONS = ['폐업·운영 종료', '다른 서비스로 바꿔요', '쓸 일이 줄었어요', '기타'];

// 설정 › 계정·사업장 종료. 되돌릴 수 없는 일이라 사업장 이름을 직접 입력하게 한다.
export function AccountClosureSection({ facilityName, facilityWord, canClose, ownsActive, isDemo }: {
  facilityName: string; facilityWord: string; canClose: boolean; ownsActive: boolean; isDemo: boolean;
}) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [agree, setAgree] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function close() {
    setMessage(null);
    start(async () => {
      const result = await closeFacilityAction({ reason });
      if (!result.ok) { setMessage({ kind: 'error', text: result.error ?? '닫지 못했어요.' }); return; }
      setMessage({ kind: 'ok', text: `${facilityWord}을(를) 닫았어요. 처음 화면으로 이동해요.` });
      setTimeout(() => window.location.replace('/'), 1200);
    });
  }
  function withdraw() {
    setMessage(null);
    start(async () => {
      const result = await withdrawAdminAccountAction();
      if (!result.ok) { setMessage({ kind: 'error', text: result.error ?? '탈퇴하지 못했어요.' }); return; }
      await supabase.auth.signOut().catch(() => undefined);
      window.location.replace('/login?withdrawn=1');
    });
  }

  return <div className="space-y-4 px-4 pt-4 pb-10">
    <section className="rounded-2xl bg-white p-5 shadow-card">
      <p className="text-label font-bold text-primary">{facilityWord} 닫기</p>
      <h2 className="mt-1 text-title font-extrabold text-ink">{facilityName}</h2>
      <ul className="mt-3 space-y-1 text-label leading-5 text-sub">
        <li>· 열린 공고와 보낸 초대가 취소되고, 지원자·근무자에게 알림이 가요.</li>
        <li>· 직원·근무자 연결이 끝나요. 근태·지급 기록은 3년간 보관돼요(임금대장).</li>
        <li>· 확정된 근무나 지급 대기가 남아 있으면 먼저 정리해야 닫을 수 있어요.</li>
        <li>· 되돌릴 수 없어요. 다시 쓰려면 새로 등록해요.</li>
      </ul>
      {isDemo ? <p className="mt-4 rounded-xl bg-bg px-3 py-2 text-label text-sub">시연 사업장은 닫을 수 없어요.</p>
        : !canClose ? <p className="mt-4 rounded-xl bg-bg px-3 py-2 text-label text-sub">사업장 소유자만 닫을 수 있어요. 소유자에게 요청해 주세요.</p>
        : <>
          <label className="mt-4 block text-label font-medium text-sub">이유 (선택)
            <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-body text-ink">
              {REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-label font-medium text-sub">확인을 위해 {facilityWord} 이름을 그대로 입력
            <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={facilityName} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-body text-ink" />
          </label>
          <button type="button" disabled={pending || typed.trim() !== facilityName.trim()} onClick={close}
            className="mt-4 h-12 w-full rounded-xl bg-red-600 text-body font-extrabold text-white disabled:opacity-40">{pending ? '처리 중...' : `${facilityWord} 닫기`}</button>
        </>}
    </section>

    <section className="rounded-2xl bg-white p-5 shadow-card">
      <p className="text-label font-bold text-primary">내 관리자 계정</p>
      <h2 className="mt-1 text-title font-extrabold text-ink">계정 탈퇴</h2>
      <p className="mt-2 text-label leading-5 text-sub">관리자 권한이 모두 사라지고 로그인할 수 없게 돼요. 운영 중인 사업장이 있으면 먼저 닫거나 다른 관리자에게 넘긴 뒤 탈퇴할 수 있어요.</p>
      {isDemo ? <p className="mt-4 rounded-xl bg-bg px-3 py-2 text-label text-sub">시연 계정은 탈퇴할 수 없어요.</p>
        : ownsActive ? <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-label font-bold text-amber-700">운영 중인 {facilityWord}이(가) 있어요. 위에서 먼저 닫아 주세요.</p>
        : <>
          <label className="mt-4 flex items-start gap-2 text-label text-ink">
            <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>탈퇴하면 되돌릴 수 없다는 것을 확인했어요.</span>
          </label>
          <button type="button" disabled={pending || !agree} onClick={withdraw}
            className="mt-4 h-12 w-full rounded-xl border border-red-200 bg-white text-body font-extrabold text-red-600 disabled:opacity-40">{pending ? '처리 중...' : '관리자 계정 탈퇴'}</button>
        </>}
    </section>
    {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3 py-2 text-label font-bold ${message.kind === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>{message.text}</p>}
  </div>;
}
