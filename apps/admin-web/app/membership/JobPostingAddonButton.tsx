'use client';
import { useState } from 'react';

declare global { interface Window { TossPayments?: (key: string) => { requestPayment: (method: string, options: Record<string, unknown>) => Promise<void> } } }

export function JobPostingAddonButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function purchase() {
    const key = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    if (!key) { setError('결제 환경 설정이 필요해요.'); return; }
    setBusy(true); setError('');
    try {
      const invoiceResponse = await fetch('/api/addons/job-posting', { method: 'POST' });
      const invoice = await invoiceResponse.json();
      if (!invoiceResponse.ok) throw new Error(invoice.error ?? '추가 공고 청구서 생성 실패');
      const orderResponse = await fetch('/api/payments/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.invoiceId }),
      });
      const order = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(order.error ?? '결제 주문 생성 실패');
      if (!window.TossPayments) await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://js.tosspayments.com/v1/payment';
        script.onload = () => resolve(); script.onerror = () => reject(new Error('결제창 로드 실패'));
        document.head.appendChild(script);
      });
      await window.TossPayments!(key).requestPayment('카드', {
        amount: order.amount, orderId: order.orderId, orderName: '잇닿 추가 공고 1건',
        customerName: '잇닿 사업장 관리자', successUrl: `${location.origin}/membership/success`,
        failUrl: `${location.origin}/membership/fail?localOrderId=${encodeURIComponent(order.orderId)}`,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '결제창을 열지 못했어요.'); setBusy(false);
    }
  }
  return <div>
    <button type="button" onClick={purchase} disabled={busy} aria-busy={busy}
      className="w-full h-11 rounded-xl bg-primary text-white text-label font-extrabold disabled:opacity-50">
      {busy ? '결제 준비 중...' : '공고 1건 추가 · 9,900원'}
    </button>
    {error && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{error}</p>}
  </div>;
}
