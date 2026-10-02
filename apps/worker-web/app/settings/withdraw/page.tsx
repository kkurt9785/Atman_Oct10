'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { setGigworkerModePreference } from '@/lib/worker-mode';

// 회원 탈퇴 — 무엇이 지워지고 무엇이 남는지 먼저 보여 주고, 확인 한 번으로 끝낸다
export default function WithdrawPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function withdraw() {
    if (!agreed || busy) return;
    setBusy(true);
    setError('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); setError('로그인이 만료됐어요. 다시 로그인한 뒤 탈퇴해 주세요.'); return; }
    // 면허 사진 파일은 본인 권한으로 먼저 지운다(계정이 사라지면 지울 수 없다)
    try {
      const { data: files } = await supabase.storage.from('license-photos').list(user.id);
      const paths = (files ?? []).map((file) => `${user.id}/${file.name}`);
      if (paths.length) await supabase.storage.from('license-photos').remove(paths);
    } catch { /* 파일이 없거나 이미 지워진 경우 */ }
    const { error: rpcError } = await supabase.rpc('withdraw_my_account');
    if (rpcError) {
      setBusy(false);
      setError(rpcError.message.replace(/^.*?: /, '') || '탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    await supabase.auth.signOut().catch(() => undefined);
    setGigworkerModePreference(false);
    try { window.localStorage.clear(); } catch { /* 저장소 접근 불가 */ }
    setDone(true);
  }

  if (done) {
    return (
      <main className="min-h-screen bg-white px-6 pt-20 text-center">
        <p className="text-[22px] font-extrabold text-ink">탈퇴가 끝났어요</p>
        <p className="mt-3 text-[14px] leading-6 text-sub">그동안 잇닿을 이용해 주셔서 고마워요.<br />다시 일을 찾을 때 언제든 카카오로 새로 시작할 수 있어요.</p>
        <Link href="/" className="mt-8 inline-flex h-12 items-center justify-center rounded-btn bg-bg px-6 text-[15px] font-bold text-ink">처음 화면으로</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg px-5 pb-28 pt-6">
      <button type="button" onClick={() => router.back()} className="inline-flex h-9 items-center gap-1 text-[14px] font-bold text-sub"><span aria-hidden="true">←</span> 내 정보</button>
      <h1 className="mt-3 text-[24px] font-extrabold text-ink">회원 탈퇴</h1>
      <p className="mt-2 text-[14px] leading-6 text-sub">탈퇴하면 바로 처리되고 되돌릴 수 없어요.</p>

      <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-[15px] font-bold text-ink">바로 지워져요</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-6 text-sub">
          <li>로그인 계정, 연락처, 생년월일, 면허번호·면허 사진, 프로필 사진</li>
          <li>활동 지역, 지급 계좌번호, 알림 설정</li>
          <li>답하지 않은 근무 요청·지원, 진행 중인 대타 요청</li>
        </ul>
        <p className="mt-4 text-[15px] font-bold text-ink">3년 동안 보관돼요</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-6 text-sub">
          <li>이미 한 근무의 출퇴근·지급 기록과 근무 관련 대화(이름·직군과 함께) — 사업장의 근로관계 기록이라 법에서 보관을 정하고 있어요. 3년이 지나면 이름 등을 지워 익명으로 바꿔요</li>
          <li>동의·철회 기록</li>
        </ul>
        <p className="mt-4 rounded-xl bg-bg px-3 py-2.5 text-[13px] leading-5 text-sub">앞으로 확정된 근무가 남아 있으면 탈퇴할 수 없어요. 내 근무에서 대타를 구하거나 사업장과 먼저 정리해 주세요.</p>
      </section>

      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#1B64DA]" />
        <span className="text-[14px] font-semibold text-ink">위 내용을 확인했고 탈퇴할게요</span>
      </label>

      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] font-bold text-red-600">{error}</p>}

      <button type="button" onClick={withdraw} disabled={!agreed || busy} className="mt-4 h-12 w-full rounded-btn border border-red-200 bg-white text-[15px] font-bold text-red-600 disabled:opacity-50">
        {busy ? '처리 중…' : '탈퇴하기'}
      </button>
      <button type="button" onClick={() => router.back()} className="mt-2 flex h-12 w-full items-center justify-center rounded-btn bg-primary text-[15px] font-extrabold text-white">계속 이용할게요</button>
    </main>
  );
}
