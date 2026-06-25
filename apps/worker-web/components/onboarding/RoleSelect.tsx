'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

const ROLES = [
  {
    id: 'rn',
    title: '간호사 (RN)',
    desc: '정규간호사 면허 소지자',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="14" fill="#EBF3FF"/>
        <path d="M14 8v12M8 14h12" stroke="#3182F6" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'na',
    title: '간호조무사',
    desc: '간호조무사 자격증 소지자',
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="14" fill="#F2F4F6"/>
        <path d="M14 9.5C12.067 9.5 10.5 11.067 10.5 13c0 1.038.45 1.97 1.167 2.614L10 19h8l-1.667-3.386A3.496 3.496 0 0017.5 13c0-1.933-1.567-3.5-3.5-3.5z" stroke="#4E5968" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
    ),
  },
];

export function RoleSelect({ onNext }: { onNext: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">단계 1 / 정보 입력</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-8">어떤 자격이신가요?</h1>

      <div className="flex flex-col gap-4 flex-1">
        {ROLES.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`flex items-center gap-5 p-6 rounded-card border-2 transition-all text-left ${
              selected === r.id
                ? 'border-primary bg-primary-light'
                : 'border-line bg-white'
            }`}
            style={{ minHeight: 90 }}
          >
            {r.icon}
            <div>
              <p className={`text-[18px] font-bold ${selected === r.id ? 'text-primary' : 'text-ink'}`}>{r.title}</p>
              <p className="text-[14px] text-sub mt-0.5">{r.desc}</p>
            </div>
          </button>
        ))}
      </div>

      <Button onClick={onNext} disabled={!selected}>다음 단계</Button>
    </div>
  );
}
