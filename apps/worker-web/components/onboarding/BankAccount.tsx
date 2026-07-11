'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

const BANKS = [
  { code: '090', name: '카카오뱅크' }, { code: '092', name: '토스뱅크' },
  { code: '088', name: '신한' }, { code: '004', name: 'KB국민' },
  { code: '081', name: '하나' }, { code: '020', name: '우리' },
  { code: '011', name: 'NH농협' }, { code: '003', name: 'IBK기업' },
] as const;

export type BankAccountValue = { bankCode: string; bankName: string; accountNumber: string };

export function BankAccount({ onNext, submitting, submitError }: { onNext: (value: BankAccountValue) => void; submitting?: boolean; submitError?: string }) {
  const [bankCode, setBankCode] = useState('');
  const [account, setAccount] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const selected = BANKS.find((bank) => bank.code === bankCode);

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">가입 정보 2/2</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">병원 임금 지급 계좌</h1>
      <p className="text-[15px] text-sub mb-8">근무 완료 후 병원이 직접 임금을 지급할 본인 명의 계좌예요.</p>
      <div className="relative mb-4">
        <button type="button" onClick={() => setShowDropdown((value) => !value)} className="w-full h-[52px] flex items-center justify-between px-4 bg-white rounded-card border border-line">
          <span className={`text-[16px] ${selected ? 'text-ink font-medium' : 'text-tertiary'}`}>{selected?.name ?? '은행 선택'}</span><span>⌄</span>
        </button>
        {showDropdown && <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-card shadow-card border border-line z-10 overflow-hidden">{BANKS.map((bank) => <button type="button" key={bank.code} onClick={() => { setBankCode(bank.code); setShowDropdown(false); }} className="w-full px-4 py-3.5 text-left text-[16px] text-ink hover:bg-bg border-b border-line last:border-0">{bank.name}</button>)}</div>}
      </div>
      <input type="tel" inputMode="numeric" autoComplete="off" placeholder="계좌번호 입력" value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 20))} className="w-full h-[52px] px-4 bg-white rounded-card border border-line text-[16px] text-ink placeholder:text-tertiary focus:border-primary outline-none mb-2" />
      <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 mb-10">
        <p className="text-[13px] text-sub leading-5">잇닿은 근무시간과 지급 정보를 관리하며, 임금은 채용 병원이 직접 지급합니다. 계좌번호는 서버에서 암호화해요.</p>
      </div>
      <div className="mt-auto">
        {submitError && <p className="text-[13px] font-bold text-red-600 text-center mb-3">{submitError}</p>}
        <Button onClick={() => selected && onNext({ bankCode: selected.code, bankName: selected.name, accountNumber: account })} disabled={!selected || account.length < 8 || submitting}>{submitting ? '처리 중...' : '등록하고 시작하기'}</Button>
      </div>
    </div>
  );
}
