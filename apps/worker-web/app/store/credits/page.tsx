'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type PaymentRow = {
  id: string;
  gross_amount: number;
  net_amount: number;
  deduction_status: string;
  due_date: string | null;
  status: string;
  created_at: string;
  dispute_reason: string | null;
  shifts: { shift_date: string; start_time: string; end_time: string; facilities: { name: string } | null } | null;
};

const STATUS: Record<string, { label: string; style: string }> = {
  draft: { label: '병원 검토 전', style: 'bg-slate-100 text-slate-600' },
  approved: { label: '지급 승인', style: 'bg-blue-50 text-blue-700' },
  exported: { label: '이체 준비', style: 'bg-violet-50 text-violet-700' },
  paid: { label: '병원 지급 완료', style: 'bg-green-50 text-green-700' },
  worker_confirmed: { label: '입금 확인', style: 'bg-green-100 text-green-800' },
  disputed: { label: '확인 요청 중', style: 'bg-red-50 text-red-600' },
  cancelled: { label: '취소', style: 'bg-slate-100 text-slate-500' },
};

function won(value: number) { return `₩${Math.round(value).toLocaleString('ko-KR')}`; }

export default function EarningsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/'); return; }
    const { data, error: queryError } = await supabase
      .from('wage_payment_instructions')
      .select('id,gross_amount,net_amount,deduction_status,due_date,status,created_at,dispute_reason,shifts(shift_date,start_time,end_time,facilities(name))')
      .order('created_at', { ascending: false });
    if (queryError) setLoadError('지급 현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    setRows((data ?? []) as unknown as PaymentRow[]);
    setLoading(false);
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: 'confirm' | 'dispute', reason: string | null = null) {
    if (action === 'dispute' && (!reason || reason.trim().length < 5)) return;
    setBusyId(id); setActionError('');
    const { error: actionError } = await supabase.rpc('update_wage_payment_status', {
      p_instruction_id: id, p_action: action, p_payment_reference: null, p_dispute_reason: reason,
    });
    if (actionError) setActionError(actionError.message.replace(/^.*: /, ''));
    else await load();
    setBusyId(null);
  }

  const pending = rows.filter((row) => ['draft','approved','exported'].includes(row.status)).reduce((sum, row) => sum + row.net_amount, 0);
  const paid = rows.filter((row) => ['paid','worker_confirmed'].includes(row.status)).reduce((sum, row) => sum + row.net_amount, 0);

  return <main className="min-h-screen bg-bg pb-20">
    <header className="bg-white px-5 pt-12 pb-5">
      <button onClick={() => router.back()} className="text-[14px] text-sub mb-4">← 돌아가기</button>
      <p className="text-[12px] font-bold text-primary mb-1">병원 직접 지급</p>
      <h1 className="text-[26px] font-extrabold text-ink">급여 지급 현황</h1>
      <p className="text-[13px] text-sub mt-2 leading-5">잇닿은 근무시간과 지급 정보를 관리하고, 임금은 채용 병원이 워커가 등록한 본인 명의 계좌로 직접 지급합니다.</p>
    </header>

    <section className="grid grid-cols-2 gap-3 px-5 -mt-1 py-5">
      <div className="bg-white rounded-2xl p-4 shadow-card"><p className="text-[12px] text-sub">지급 예정</p><p className="text-[20px] font-extrabold text-ink mt-1">{won(pending)}</p></div>
      <div className="bg-white rounded-2xl p-4 shadow-card"><p className="text-[12px] text-sub">지급 완료</p><p className="text-[20px] font-extrabold text-primary mt-1">{won(paid)}</p></div>
    </section>

    {actionError && <p role="alert" className="mx-5 mb-3 rounded-xl bg-red-50 px-4 py-3 text-[12px] font-bold text-red-600">{actionError}</p>}
    <section className="px-5">
      {loading ? <div className="bg-white rounded-2xl p-8 text-center text-[13px] text-sub">지급 내역을 불러오는 중...</div>
      : loadError ? <div role="alert" className="bg-white rounded-2xl border border-red-200 p-8 text-center"><p className="font-bold text-red-600">지급 현황을 불러오지 못했어요</p><p className="text-[12px] text-sub mt-2">{loadError}</p><button type="button" onClick={() => void load()} className="mt-4 h-10 px-4 rounded-xl bg-ink text-white text-[13px] font-bold">다시 불러오기</button></div>
      : rows.length === 0 ? <div className="bg-white rounded-2xl p-8 text-center"><p className="font-bold text-ink">아직 지급 내역이 없어요</p><p className="text-[12px] text-sub mt-2">근무 체크아웃이 완료되면 병원 지급 요청이 여기에 표시돼요.</p></div>
      : <div className="space-y-3">{rows.map((row) => {
        const shift = row.shifts; const state = STATUS[row.status] ?? STATUS.draft;
        return <article key={row.id} className="bg-white rounded-2xl p-4 shadow-card">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[15px] font-extrabold text-ink">{shift?.facilities?.name ?? '채용 병원'}</p><p className="text-[12px] text-sub mt-1">{shift?.shift_date ?? new Date(row.created_at).toLocaleDateString('ko-KR')} · {shift?.start_time?.slice(0,5)}–{shift?.end_time?.slice(0,5)}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${state.style}`}>{state.label}</span></div>
          <div className="mt-4 rounded-xl bg-bg p-3 space-y-2 text-[12px]"><div className="flex justify-between"><span className="text-sub">예상 세전액</span><b>{won(row.gross_amount)}</b></div><div className="flex justify-between"><span className="text-sub">공제</span><b>{row.deduction_status === 'unconfirmed' ? '병원 확인 예정' : '병원 확인'}</b></div><div className="flex justify-between border-t border-line pt-2"><span className="font-bold">지급 예정액</span><b className="text-primary">{won(row.net_amount)}</b></div>{row.due_date && <div className="flex justify-between"><span className="text-sub">지급 예정일</span><b>{row.due_date}</b></div>}</div>
          {row.status === 'paid' && <button disabled={busyId===row.id} onClick={() => void act(row.id,'confirm')} className="mt-3 w-full h-11 rounded-xl bg-primary text-white text-[13px] font-extrabold disabled:opacity-50">내 계좌 입금 확인</button>}
          {['approved','exported','paid'].includes(row.status) && <button disabled={busyId===row.id} onClick={() => { setDisputeTarget(row.id); setDisputeReason(''); }} className="mt-2 w-full py-2 text-[12px] font-bold text-sub disabled:opacity-50">금액·입금 문제 확인 요청</button>}
          {row.dispute_reason && <p className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] text-red-600">요청 내용: {row.dispute_reason}</p>}
        </article>;
      })}</div>}
    </section>
    <p className="px-5 mt-5 text-[11px] leading-5 text-tertiary">표시 금액은 병원의 최종 공제 판단 전 예상액일 수 있습니다. 잇닿은 임금을 수취하거나 재지급하지 않습니다.</p>
  
    {/* 이의제기 바텀시트 — window.prompt 대체 */}
    {disputeTarget && (
      <>
        <div className="fixed inset-0 bg-black/40 z-40" onClick={() => busyId === null && setDisputeTarget(null)} />
        <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-[24px] z-50 px-6 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          <div className="w-10 h-1 bg-line rounded-full mx-auto mb-5" />
          <p className="text-[17px] font-bold text-ink">금액·입금 문제 확인 요청</p>
          <p className="text-[13px] text-sub mt-1 leading-5">병원 급여 담당자가 확인할 내용을 구체적으로 적어주세요. (5자 이상)</p>
          <textarea
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            rows={3}
            placeholder="예: 7/18 야간 근무 시간이 실제와 달라요"
            className="mt-4 w-full rounded-xl border border-line px-4 py-3 text-[15px] outline-none focus:border-primary resize-none"
          />
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              onClick={() => setDisputeTarget(null)}
              disabled={busyId !== null}
              className="h-12 rounded-xl border border-line text-[14px] font-bold text-sub"
            >
              닫기
            </button>
            <button
              onClick={async () => { await act(disputeTarget, 'dispute', disputeReason); setDisputeTarget(null); }}
              disabled={busyId !== null || disputeReason.trim().length < 5}
              className="h-12 rounded-xl bg-primary text-white text-[14px] font-extrabold disabled:opacity-50"
            >
              {busyId ? '접수 중...' : '확인 요청 보내기'}
            </button>
          </div>
        </div>
      </>
    )}
</main>;
}
