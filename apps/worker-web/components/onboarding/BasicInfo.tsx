'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export type BasicInfoValue = { name: string; birthDate: string; phone: string };

function formatBirth(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

function formatPhone(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function birthError(birth: string): string | null {
  if (birth.length !== 10) return null; // 입력 중에는 침묵
  const dt = new Date(birth);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== birth) return '올바른 날짜가 아니에요';
  const age = (Date.now() - dt.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 18) return '만 18세 이상만 가입할 수 있어요';
  if (age > 90) return '생년월일을 다시 확인해주세요';
  return null;
}

export function BasicInfo({ onNext }: { onNext: (value: BasicInfoValue) => void }) {
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [phone, setPhone] = useState('');

  const bErr = birthError(birth);
  const phoneDigits = phone.replace(/\D/g, '');
  const valid =
    name.trim().length >= 2 &&
    birth.length === 10 &&
    !bErr &&
    phoneDigits.length === 11 &&
    phoneDigits.startsWith('010');

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">가입 정보 1/2</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">본인 정보를 입력해주세요</h1>
      <p className="text-[15px] text-sub mb-8">면허 확인과 급여 지급에 사용돼요</p>

      <label className="text-[13px] font-semibold text-sub mb-1.5">이름 (실명)</label>
      <input
        type="text"
        placeholder="홍길동"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full h-[52px] px-4 bg-white rounded-card border border-line text-[16px] text-ink placeholder:text-tertiary focus:border-primary outline-none mb-5"
      />

      <label className="text-[13px] font-semibold text-sub mb-1.5">생년월일</label>
      <input
        type="tel"
        placeholder="1990-01-01"
        value={birth}
        onChange={(e) => setBirth(formatBirth(e.target.value))}
        className="w-full h-[52px] px-4 bg-white rounded-card border border-line text-[16px] text-ink placeholder:text-tertiary focus:border-primary outline-none mb-1"
      />
      <p className={`text-[13px] mb-4 ${bErr ? 'text-red-600 font-bold' : 'text-transparent'}`}>{bErr ?? '.'}</p>

      <label className="text-[13px] font-semibold text-sub mb-1.5">휴대폰 번호</label>
      <input
        type="tel"
        placeholder="010-0000-0000"
        value={phone}
        onChange={(e) => setPhone(formatPhone(e.target.value))}
        className="w-full h-[52px] px-4 bg-white rounded-card border border-line text-[16px] text-ink placeholder:text-tertiary focus:border-primary outline-none mb-2"
      />
      <p className="text-[13px] text-tertiary">시프트 매칭·정산 알림을 받을 번호예요</p>

      <div className="mt-auto">
        <Button
          onClick={() => onNext({ name: name.trim(), birthDate: birth, phone: formatPhone(phone) })}
          disabled={!valid}
          variant={valid ? 'primary' : 'outline'}
        >
          다음
        </Button>
      </div>
    </div>
  );
}
