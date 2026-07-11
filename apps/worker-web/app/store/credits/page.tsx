'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type LedgerRow = { id: string; delta: number; kind: string; memo: string | null; created_at: string };
type PayoutRow = { id: string; amount: number; bank_name: string | null; account_last4: string | null; status: string; requested_at: string };

const KIND_LABEL: Record<string, string> = {
  earn: '적립', spend: '사용', payout: '환급', adjust: '조정',
};
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending:  { text: '처리 중', cls: 'bg-amber-50 text-amber-600' },
  paid:     { text: '환급 완료', cls: 'bg-green-50 text-green-600' },
  rejected: { text: '거절됨', cls: 'bg-red-50 text-red-500' },
};

function dateLabel(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

export default function CreditsPage() {
  const router = useRouter();
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [bank, setBank] = useState<{ name: string; last4: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const [showSheet, setShowSheet] = useState(false);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const pendingSum = payouts.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  // request_credit_payout() reserves funds immediately with a negative ledger row.
  const refundable = Math.max(0, balance);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/shifts'); return; }

    const [{ data: bal }, { data: rows }, { data: reqs }, { data: bankRow }] = await Promise.all([
      supabase.rpc('get_my_credit_balance'),
      supabase.from('worker_credit_ledger').select('id, delta, kind, memo, created_at').order('created_at', { ascending: false }).limit(30),
      supabase.from('credit_payout_requests').select('id, amount, bank_name, account_last4, status, requested_at').order('requested_at', { ascending: false }).limit(10),
      supabase.from('worker_bank_accounts').select('bank_name, account_number_last4').eq('is_primary', true).is('deleted_at', null).maybeSingle(),
    ]);

    setBalance(typeof bal === 'number' ? bal : 0);
    setLedger((rows ?? []) as LedgerRow[]);
    setPayouts((reqs ?? []) as PayoutRow[]);
    if (bankRow?.bank_name) setBank({ name: bankRow.bank_name as string, last4: (bankRow.account_number_last4 as string) ?? '' });
    setLoading(false);
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function submitPayout() {
    const n = Number(amount.replace(/\D/g, ''));
    if (!n) return;
    setSubmitting(true);
    setError('');
    const { error: err } = await supabase.rpc('request_credit_payout', { p_amount: n });
    setSubmitting(false);
    if (err) {
      setError(err.message.replace(/^.*: /, ''));
      return;
    }
    setDone(true);
    await load();
  }

  function openSheet() {
    setAmount(String(refundable));
    setError('');
    setDone(false);
    setShowSheet(true);
  }

  return (
    <div className="pb-16 min-h-screen bg-bg">
      {/* 헤더 */}
      <div className="bg-white px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-ink text-[20px] leading-none -ml-1 p-1">←</button>
        <h1 className="text-[18px] font-extrabold text-ink">내 적립금</h1>
      </div>

      {/* 잔액 카드 */}
      <div className="bg-white px-5 pb-6">
        <p className="text-[13px] text-sub">사용 가능 적립금</p>
        <p className="text-[34px] font-extrabold text-ink mt-1">₩{balance.toLocaleString('ko-KR')}</p>
        {pendingSum > 0 && (
          <p className="text-[12px] text-amber-600 font-semibold mt-1">환급 처리 중 ₩{pendingSum.toLocaleString('ko-KR')}</p>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={openSheet}
            disabled={refundable < 1000}
            className="flex-1 h-12 rounded-xl bg-primary text-white text-[14px] font-extrabold disabled:opacity-40"
          >
            계좌로 환급
          </button>
          <button
            onClick={() => router.push('/store')}
            className="flex-1 h-12 rounded-xl bg-bg text-ink text-[14px] font-extrabold"
          >
            스토어에서 쓰기
          </button>
        </div>
        {refundable < 1000 && (
          <p className="text-[11px] text-tertiary mt-2">환급은 1,000원부터 신청할 수 있어요</p>
        )}
      </div>

      {/* 환급 신청 내역 */}
      {payouts.length > 0 && (
        <div className="mt-3 bg-white px-5 py-4">
          <p className="text-[14px] font-bold text-ink mb-3">환급 신청 내역</p>
          <div className="divide-y divide-line">
            {payouts.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-bold text-ink">₩{p.amount.toLocaleString('ko-KR')}</p>
                  <p className="text-[12px] text-sub">{p.bank_name} ****{p.account_last4} · {dateLabel(p.requested_at)}</p>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_LABEL[p.status]?.cls ?? ''}`}>
                  {STATUS_LABEL[p.status]?.text ?? p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 적립·사용 내역 */}
      <div className="mt-3 bg-white px-5 py-4">
        <p className="text-[14px] font-bold text-ink mb-3">적립·사용 내역</p>
        {loading ? (
          <p className="text-[13px] text-tertiary py-6 text-center">불러오는 중...</p>
        ) : ledger.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[14px] font-bold text-ink">아직 내역이 없어요</p>
            <p className="text-[12px] text-sub mt-1">시프트를 완료하면 적립금이 쌓여요</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {ledger.map((l) => (
              <div key={l.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-bold text-ink">{KIND_LABEL[l.kind] ?? l.kind}</p>
                  <p className="text-[12px] text-sub">{l.memo ?? ''} {dateLabel(l.created_at)}</p>
                </div>
                <p className={`text-[14px] font-extrabold ${l.delta >= 0 ? 'text-primary' : 'text-ink'}`}>
                  {l.delta >= 0 ? '+' : ''}{l.delta.toLocaleString('ko-KR')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 환급 신청 바텀시트 */}
      {showSheet && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowSheet(false)} />
          <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-3xl z-50 px-5 pt-6 pb-10">
            <div className="w-10 h-1 bg-line rounded-full mx-auto mb-5" />
            {done ? (
              <div className="text-center py-4">
                <p className="text-[40px] mb-2">✅</p>
                <p className="text-[18px] font-extrabold text-ink">환급 신청 완료</p>
                <p className="text-[13px] text-sub mt-2">영업일 기준 1~2일 내 입금돼요</p>
                <button onClick={() => setShowSheet(false)} className="w-full h-13 mt-6 py-3.5 rounded-xl bg-primary text-white text-[15px] font-extrabold">
                  확인
                </button>
              </div>
            ) : (
              <>
                <p className="text-[18px] font-extrabold text-ink mb-1">계좌로 환급</p>
                <p className="text-[13px] text-sub mb-5">
                  {bank ? `${bank.name} ****${bank.last4} 계좌로 입금돼요` : '등록된 계좌로 입금돼요'}
                </p>
                <div className="bg-bg rounded-2xl px-4 py-3 mb-2 flex items-center justify-between">
                  <span className="text-[13px] text-sub">환급 가능</span>
                  <span className="text-[14px] font-bold text-ink">₩{refundable.toLocaleString('ko-KR')}</span>
                </div>
                <input
                  type="tel"
                  value={amount ? Number(amount.replace(/\D/g, '')).toLocaleString('ko-KR') : ''}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                  placeholder="환급할 금액"
                  className="w-full h-[52px] px-4 bg-white rounded-xl border border-line text-[18px] font-bold text-ink focus:border-primary outline-none mb-2"
                />
                {error && <p className="text-[12px] font-bold text-red-500 mb-2">{error}</p>}
                <button
                  onClick={submitPayout}
                  disabled={submitting || !Number(amount.replace(/\D/g, ''))}
                  className="w-full h-13 py-3.5 rounded-xl bg-primary text-white text-[15px] font-extrabold disabled:opacity-40"
                >
                  {submitting ? '신청 중...' : '환급 신청하기'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
