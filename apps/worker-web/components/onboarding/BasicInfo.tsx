'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export type BasicInfoValue = { name: string; phone: string };

function formatPhone(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function BasicInfo({ birthDate, onNext }: { birthDate: string; onNext: (value: BasicInfoValue) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const phoneDigits = phone.replace(/\D/g, '');
  const valid = name.trim().length >= 2 && /^010\d{8}$/.test(phoneDigits);

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">가입 정보 1/2</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">본인 정보를 입력해주세요</h1>
      <p className="text-[15px] text-sub mb-8">면허 확인과 급여 지급에 사용돼요.</p>

      <label className="text-[13px] font-semibold text-sub mb-1.5">이름 (실명)</label>
      <input type="text" autoComplete="name" placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} className="w-full h-[52px] px-4 bg-white rounded-card border border-line text-[16px] text-ink placeholder:text-tertiary focus:border-primary outline-none mb-5" />

      <label className="text-[13px] font-semibold text-sub mb-1.5">확인된 생년월일</label>
      <div className="w-full h-[52px] px-4 bg-bg rounded-card border border-line text-[16px] text-sub flex items-center mb-5">{birthDate}</div>

      <label className="text-[13px] font-semibold text-sub mb-1.5">휴대폰 번호</label>
      <input type="tel" inputMode="numeric" autoComplete="tel" placeholder="010-0000-0000" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} className="w-full h-[52px] px-4 bg-white rounded-card border border-line text-[16px] text-ink placeholder:text-tertiary focus:border-primary outline-none mb-2" />
      <p className="text-[13px] text-tertiary">공고 지원·병원 채용확정·급여 상태 알림을 받을 번호예요.</p>

      <div className="mt-auto">
        <Button onClick={() => onNext({ name: name.trim(), phone: formatPhone(phone) })} disabled={!valid} variant={valid ? 'primary' : 'outline'}>다음</Button>
      </div>
    </div>
  );
}
