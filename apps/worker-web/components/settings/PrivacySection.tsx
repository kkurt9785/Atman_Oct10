'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getMyConsents, setMyConsent, type MyConsents } from '@/lib/consents';

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors ${on ? 'bg-primary' : 'bg-line'}`}>
      <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </span>
  );
}

// 동의 철회와 탈퇴는 가입만큼 쉽게 — 내 정보에서 바로 켜고 끈다
export function PrivacySection({ dark = false }: { dark?: boolean }) {
  const [consents, setConsents] = useState<MyConsents | null>(null);
  const [busy, setBusy] = useState<'marketing' | 'location_data' | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => { void getMyConsents().then(setConsents).catch(() => setConsents({ marketing: false, location: true })); }, []);

  async function toggle(type: 'marketing' | 'location_data') {
    if (!consents || busy) return;
    const current = type === 'marketing' ? consents.marketing : consents.location;
    if (type === 'location_data' && current && !window.confirm('위치정보 이용 동의를 철회할까요?\n출퇴근은 사업장 동적 QR·와이파이로만 인증되고, 현재 위치로 공고를 볼 수 없어요.')) return;
    setBusy(type);
    setNotice('');
    const result = await setMyConsent(type, !current);
    setBusy(null);
    if (!result.ok) { setNotice(result.message ?? '동의 상태를 바꾸지 못했어요.'); return; }
    setConsents((prev) => prev && (type === 'marketing' ? { ...prev, marketing: !current } : { ...prev, location: !current }));
    setNotice(type === 'marketing'
      ? (!current ? '혜택·이벤트 알림 수신에 동의했어요.' : '혜택·이벤트 알림을 보내지 않을게요.')
      : (!current ? '위치정보 이용에 다시 동의했어요.' : '위치정보 이용 동의를 철회했어요.'));
  }

  const card = dark ? 'bg-white/8 text-white' : 'bg-white shadow-sm';
  const title = dark ? 'text-white' : 'text-ink';
  const sub = dark ? 'text-white/60' : 'text-tertiary';

  return (
    <section className="mb-4" aria-labelledby="privacy-title">
      <p id="privacy-title" className={`mb-2 px-1 text-[13px] font-bold ${dark ? 'text-white/70' : 'text-sub'}`}>개인정보·동의</p>
      <div className={`divide-y ${dark ? 'divide-white/10' : 'divide-line'} rounded-2xl ${card}`}>
        <button type="button" onClick={() => toggle('marketing')} disabled={!consents || busy !== null} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left disabled:opacity-60">
          <span><span className={`block text-[15px] font-bold ${title}`}>혜택·이벤트 알림 (선택)</span><span className={`mt-0.5 block text-[12px] ${sub}`}>근무·지급 같은 필수 알림은 이 설정과 관계없이 와요</span></span>
          <Toggle on={Boolean(consents?.marketing)} />
        </button>
        <button type="button" onClick={() => toggle('location_data')} disabled={!consents || busy !== null} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left disabled:opacity-60">
          <span><span className={`block text-[15px] font-bold ${title}`}>위치정보 이용</span><span className={`mt-0.5 block text-[12px] ${sub}`}>출근하기·현재 위치를 누를 때만 위치를 확인해요</span></span>
          <Toggle on={consents?.location ?? true} />
        </button>
        <div className={`flex flex-wrap gap-x-4 gap-y-1 px-5 py-3.5 text-[13px] font-semibold ${dark ? 'text-white/80' : 'text-sub'}`}>
          <Link href="/legal/terms" className="underline">이용약관</Link>
          <Link href="/legal/privacy" className="underline">개인정보 처리방침</Link>
          <Link href="/legal/location" className="underline">위치정보 이용약관</Link>
        </div>
        <Link href="/settings/withdraw" className={`flex items-center justify-between px-5 py-4 text-[14px] font-semibold ${dark ? 'text-white/70' : 'text-sub'}`}>
          <span>회원 탈퇴</span><span aria-hidden="true">›</span>
        </Link>
      </div>
      {notice && <p role="status" className={`mt-2 px-1 text-[12px] font-bold ${dark ? 'text-white/80' : 'text-primary'}`}>{notice}</p>}
    </section>
  );
}
