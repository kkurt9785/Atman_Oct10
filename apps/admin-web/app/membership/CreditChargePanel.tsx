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
  return <div><button onClick={pay} disabled={busy} className="w-full h-11 rounded-xl bg-primary text-white text-label font-extrabold disabled:opacity-50">{busy?'결제창 여는 중...':`${amount.toLocaleString('ko-KR')}원 결제`}</button>{error&&<p className="text-[11px] text-warn mt-2">{error}</p>}</div>;
}
