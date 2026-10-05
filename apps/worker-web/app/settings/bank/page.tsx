'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BackButton } from '@/components/BackButton';
import { BankAccount, type BankAccountValue } from '@/components/onboarding/BankAccount';
import { useDemoSession } from '@/lib/demo-session';

type Bank = { bank_name: string | null; account_number_last4: string | null };

// 지급 계좌 등록·변경 — 가입 단계에서 빼고 여기서 받는다
export default function BankSettingsPage() {
  const demo = useDemoSession();
  const [name, setName] = useState('');
  const [bank, setBank] = useState<Bank | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function loadBank() {
    const { data } = await supabase.from('worker_bank_accounts').select('bank_name,account_number_last4').eq('is_primary', true).is('deleted_at', null).maybeSingle();
    return (data as Bank | null) ?? null;
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.replace('/'); return; }
      const [{ data: worker }, current] = await Promise.all([
        supabase.from('workers').select('name').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
        loadBank(),
      ]);
      if (!active) return;
      setName(worker?.name ?? '');
      setBank(current);
      setEditing(!current);
    })();
    return () => { active = false; };
  }, []);

  async function save(value: BankAccountValue) {
    setSaving(true); setError(''); setSaved(false);
    const { error: saveError } = await supabase.rpc('upsert_my_bank_account', {
      p_bank_code: value.bankCode, p_bank_name: value.bankName,
      p_account_number: value.accountNumber, p_account_holder_name: name,
    });
    if (saveError) { setError(saveError.message.replace(/^.*?: /, '') || '계좌를 저장하지 못했어요.'); setSaving(false); return; }
    setBank(await loadBank());
    setEditing(false); setSaving(false); setSaved(true);
  }

  const label = bank?.bank_name && bank.account_number_last4 ? `${bank.bank_name} · ****${bank.account_number_last4}` : null;
  return (
    <main className="min-h-screen bg-bg px-5 pb-10 pt-4">
      <BackButton href="/settings" label="내 정보" />
      <h1 className="mt-3 text-[24px] font-extrabold text-ink">지급 계좌</h1>
      <p className="mt-1 text-[13px] leading-5 text-sub">근무를 마친 뒤 사업장이 급여를 보낼 계좌예요. 예금주는 가입한 이름({name || '본인'})이어야 해요.</p>

      <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
        {bank === undefined ? <p className="text-[13px] text-sub">확인하고 있어요...</p> : <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[17px] font-extrabold text-ink">{label ?? '아직 등록한 계좌가 없어요'}</p>
            {label && demo === false && <button type="button" onClick={() => setEditing((open) => !open)} className="shrink-0 rounded-lg bg-bg px-3 py-2 text-[12px] font-extrabold text-sub">{editing ? '닫기' : '변경'}</button>}
          </div>
          {saved && <p role="status" className="mt-2 text-[13px] font-bold text-emerald-700">저장했어요 ✓</p>}
          {demo ? <p className="mt-3 rounded-xl bg-bg p-3 text-[12px] text-sub">시연 계정에서는 계좌를 바꿀 수 없어요.</p>
            : editing && <div className="mt-3 rounded-xl bg-bg p-3"><BankAccount compact onNext={(value) => void save(value)} submitting={saving} submitError={error} /></div>}
        </>}
      </section>
    </main>
  );
}
