'use client';
import { useState } from 'react';

declare global { interface Window { TossPayments?: (key: string) => { requestPayment: (method: string, options: Record<string,unknown>) => Promise<void> } } }

export default function ServiceInvoicePayButton({ invoiceId, amount }: { invoiceId: string; amount: number }) {
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function pay() {
    const key=process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY; if(!key){setError('결제 환경 설정이 필요해요.');return;}
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/payments/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoiceId})});
      const order=await response.json(); if(!response.ok) throw new Error(order.error??'주문 생성 실패');
      if(!window.TossPayments){await new Promise<void>((resolve,reject)=>{const s=document.createElement('script');s.src='https://js.tosspayments.com/v1/payment';s.onload=()=>resolve();s.onerror=()=>reject(new Error('결제창 로드 실패'));document.head.appendChild(s);});}
      await window.TossPayments!(key).requestPayment('카드',{amount:order.amount,orderId:order.orderId,orderName:order.orderName,customerName:'잇닿 병원 관리자',successUrl:`${location.origin}/membership/success`,failUrl:`${location.origin}/membership/fail?localOrderId=${encodeURIComponent(order.orderId)}`});
    } catch(e){setError(e instanceof Error?e.message:'결제창을 열지 못했어요.');setBusy(false);}
  }
  return <div>
    <button onClick={pay} disabled={busy} aria-busy={busy} className="w-full h-11 rounded-xl bg-primary text-white text-label font-extrabold disabled:opacity-50">
      {busy?'결제 상태 확인 중...':error?'결제 다시 시도':`${amount.toLocaleString('ko-KR')}원 결제`}
    </button>
    {error&&<div role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2">
      <p className="text-[12px] font-bold text-red-600">결제가 완료되지 않았어요</p>
      <p className="text-[11px] text-sub mt-1">{error} 승인 문자를 받았다면 중복 결제하지 말고 청구서 상태를 새로고침해 확인해 주세요.</p>
    </div>}
  </div>;
}
