'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// 지급 계좌 — 가입 때는 묻지 않는다(첫 지급 전에만 있으면 된다). 내 정보 줄 + '내 근무' 알림이 같은 화면(/settings/bank)으로 잇는다.
type Bank = { bank_name: string | null; account_number_last4: string | null };

export function usePrimaryBank() {
  const [bank, setBank] = useState<Bank | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void supabase.from('worker_bank_accounts').select('bank_name,account_number_last4').eq('is_primary', true).is('deleted_at', null).maybeSingle()
      .then(({ data }) => { if (active) setBank((data as Bank | null) ?? null); });
    return () => { active = false; };
  }, []);
  return bank;
}

export const bankLabel = (bank: Bank | null | undefined) =>
  bank?.bank_name && bank.account_number_last4 ? `${bank.bank_name} · ****${bank.account_number_last4}` : null;

// 내 정보의 한 줄
export function BankAccountRow() {
  const bank = usePrimaryBank();
  const label = bankLabel(bank);
  return (
    <Link href="/settings/bank">
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-5 shadow-sm active:opacity-80">
        <div>
          <p className="mb-1.5 text-[15px] font-bold text-ink">지급 계좌</p>
          {bank === undefined ? <p className="text-[13px] text-tertiary">확인하고 있어요...</p>
            : label ? <p className="text-[13px] text-sub">{label}</p>
            : <p className="text-[13px] font-bold text-amber-700">등록해 두면 지급이 늦어지지 않아요</p>}
        </div>
        <span className="ml-3 text-tertiary">›</span>
      </div>
    </Link>
  );
}

// '내 근무'에서 확정 근무가 있는데 계좌가 없을 때만
export function BankNudge({ show }: { show: boolean }) {
  const bank = usePrimaryBank();
  if (!show || bank === undefined || bankLabel(bank)) return null;
  return (
    <Link href="/settings/bank" className="mb-4 block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-bold text-amber-700">
      지급 계좌를 등록해 두면 지급이 늦어지지 않아요 →
    </Link>
  );
}
