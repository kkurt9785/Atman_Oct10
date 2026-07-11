'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export const CONSENT_VERSION = '2026-07-draft-1';

export type TermsValue = {
  birthDate: string;
  consents: Array<{ type: string; version: string; granted: boolean }>;
};

const REQUIRED = [
  { id: 'age_over_18', label: '만 18세 이상입니다', href: null },
  { id: 'terms_of_service', label: '서비스 이용약관 동의', href: '/legal/terms' },
  { id: 'privacy_policy', label: '개인정보 수집·이용 동의', href: '/legal/privacy' },
  { id: 'location_data', label: '위치정보 이용 동의', href: '/legal/location' },
] as const;

function toBirthDate(birth: { y: string; m: string; d: string }): string | null {
  if (!/^\d{4}$/.test(birth.y) || !/^\d{1,2}$/.test(birth.m) || !/^\d{1,2}$/.test(birth.d)) return null;
  const value = `${birth.y}-${birth.m.padStart(2, '0')}-${birth.d.padStart(2, '0')}`;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const beforeBirthday = (today.getUTCMonth() + 1 < Number(birth.m))
    || (today.getUTCMonth() + 1 === Number(birth.m) && today.getUTCDate() < Number(birth.d));
  if (beforeBirthday) age -= 1;
  return age >= 18 && age <= 100 ? value : null;
}

export function Terms({ onNext }: { onNext: (value: TermsValue) => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [marketing, setMarketing] = useState(false);
  const [birth, setBirth] = useState({ y: '', m: '', d: '' });
  const birthDate = toBirthDate(birth);
  const allRequired = REQUIRED.every((item) => checked[item.id]);

  function toggleAll() {
    const turnOn = !(allRequired && marketing);
    setChecked(Object.fromEntries(REQUIRED.map((item) => [item.id, turnOn])));
    setMarketing(turnOn);
  }

  function submit() {
    if (!birthDate || !allRequired) return;
    onNext({
      birthDate,
      consents: [
        ...REQUIRED.map((item) => ({ type: item.id, version: CONSENT_VERSION, granted: true })),
        { type: 'marketing', version: CONSENT_VERSION, granted: marketing },
      ],
    });
  }

  const Check = ({ on }: { on: boolean }) => (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${on ? 'bg-primary' : 'border-2 border-line'}`}>
      {on && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-1 bg-black/40" />
      <div className="bg-white rounded-t-[24px] flex flex-col max-h-[92vh]">
        <div className="px-6 pt-6 pb-2 flex-shrink-0">
          <div className="w-10 h-1 bg-line rounded mx-auto mb-6" />
          <h2 className="text-[22px] font-bold text-ink mb-1">이용 전 확인해주세요</h2>
          <p className="text-[15px] text-sub">잇닿 서비스 이용을 위해 동의가 필요해요.</p>
          <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3">현재 약관은 QA용 초안입니다. 공개 출시 전 법률 검토와 최종 버전 확정이 필요합니다.</p>
        </div>
        <div className="overflow-y-auto flex-1 px-6 pt-4">
          <button type="button" onClick={toggleAll} className="flex items-center gap-3 w-full py-3 mb-2">
            <Check on={allRequired && marketing} /><span className="text-[17px] font-bold text-ink">전체 동의</span>
          </button>
          <div className="h-px bg-line mb-2" />
          {REQUIRED.map((item) => (
            <div key={item.id} className="flex items-center justify-between w-full py-3">
              <button type="button" onClick={() => setChecked((prev) => ({ ...prev, [item.id]: !prev[item.id] }))} className="flex items-center gap-3 text-left">
                <Check on={Boolean(checked[item.id])} />
                <span className="text-[15px] text-ink"><span className="text-primary font-medium">(필수) </span>{item.label}</span>
              </button>
              {item.href && <Link href={item.href} target="_blank" className="text-[13px] text-tertiary underline px-2">보기</Link>}
            </div>
          ))}
          <div className="flex items-center justify-between w-full py-3 mb-5">
            <button type="button" onClick={() => setMarketing((value) => !value)} className="flex items-center gap-3 text-left">
              <Check on={marketing} /><span className="text-[15px] text-ink"><span className="text-tertiary font-medium">(선택) </span>마케팅 알림 수신</span>
            </button>
            <Link href="/legal/marketing" target="_blank" className="text-[13px] text-tertiary underline px-2">보기</Link>
          </div>
          <div className="bg-bg rounded-card p-4 mb-2">
            <p className="text-[14px] font-semibold text-sub mb-3">생년월일 입력</p>
            <div className="flex gap-2">
              {([
                { k: 'y', placeholder: '출생 연도', max: 4, label: '년' },
                { k: 'm', placeholder: '월', max: 2, label: '월' },
                { k: 'd', placeholder: '일', max: 2, label: '일' },
              ] as const).map(({ k, placeholder, max, label }) => (
                <div key={k} className="flex-1 relative">
                  <input type="tel" inputMode="numeric" value={birth[k]} onChange={(e) => setBirth((prev) => ({ ...prev, [k]: e.target.value.replace(/\D/g, '').slice(0, max) }))} placeholder={placeholder} className="w-full h-12 rounded-xl border border-line bg-white text-center text-[16px] font-bold text-ink outline-none focus:border-primary placeholder:text-tertiary placeholder:text-[13px] placeholder:font-normal" />
                  {birth[k] && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-tertiary">{label}</span>}
                </div>
              ))}
            </div>
          </div>
          {birth.y && birth.m && birth.d && !birthDate && <p className="text-[12px] font-bold text-red-600 mb-5">유효한 생년월일과 만 18세 이상 여부를 확인해 주세요.</p>}
        </div>
        <div className="px-6 pb-10 pt-3 flex-shrink-0 border-t border-line">
          <Button onClick={submit} disabled={!allRequired || !birthDate}>동의하고 계속하기</Button>
        </div>
      </div>
    </div>
  );
}
