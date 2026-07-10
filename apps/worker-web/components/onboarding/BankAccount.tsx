'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

const BANKS = ['카카오뱅크', '토스뱅크', '신한', 'KB국민', '하나', '우리', 'NH농협', 'IBK기업'];

export type BankAccountValue = { bankName: string; accountNumber: string };

export function BankAccount({
  onNext,
  submitting,
  submitError,
}: {
  onNext: (value: BankAccountValue) => void;
  submitting?: boolean;
  submitError?: string;
}) {
  const [bank, setBank] = useState('');
  const [account, setAccount] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      <p className="text-[13px] font-medium text-tertiary mb-2">가입 정보 2/2</p>
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-2">정산받을 계좌</h1>
      <p className="text-[15px] text-sub mb-8">급여를 받을 계좌를 등록해주세요</p>

      {/* Bank selector */}
      <div className="relative mb-4">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="w-full h-[52px] flex items-center justify-between px-4 bg-white rounded-card border border-line"
        >
          <span className={`text-[16px] ${bank ? 'text-ink font-medium' : 'text-tertiary'}`}>
            {bank || '은행 선택'}
          </span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={`transition-transform ${showDropdown ? 'rotate-180' : ''}`}>
            <path d="M4 6l4 4 4-4" stroke="#8B95A1" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {showDropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-card shadow-card border border-line z-10 overflow-hidden">
            {BANKS.map((b) => (
              <button key={b} onClick={() => { setBank(b); setShowDropdown(false); }}
                className="w-full px-4 py-3.5 text-left text-[16px] text-ink hover:bg-bg active:bg-bg border-b border-line last:border-0">
                {b}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Account number */}
      <input
        type="tel"
        placeholder="계좌번호 입력"
        value={account}
        onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))}
        className="w-full h-[52px] px-4 bg-white rounded-card border border-line text-[16px] text-ink placeholder:text-tertiary focus:border-primary outline-none mb-2"
      />
      <p className="text-[13px] text-tertiary mb-10">본인 명의의 계좌만 등록 가능해요. 계좌 인증은 첫 정산 전에 진행돼요.</p>

      <div className="mt-auto">
        {submitError && (
          <p className="text-[13px] font-bold text-red-600 text-center mb-3">{submitError}</p>
        )}
        <Button
          onClick={() => onNext({ bankName: bank, accountNumber: account })}
          disabled={!bank || account.length < 10 || submitting}
        >
          {submitting ? '처리 중...' : '등록하고 시작하기'}
        </Button>
      </div>
    </div>
  );
}
