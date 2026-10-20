'use client';
import {useState} from 'react';

export function PlanContact({plans,facilityId}:{plans:{code:string;name:string}[];facilityId:string}) {
  const [plan,setPlan]=useState(plans[0]?.code??'');
  const [cycle,setCycle]=useState('월간');
  const [notice,setNotice]=useState('');
  const message=`잇닿 이용 문의\n현장 ID: ${facilityId}\n희망 요금제: ${plans.find(item=>item.code===plan)?.name??'상담 후 결정'}\n결제 주기: ${cycle}\n전환 가능 여부와 견적 안내 부탁드립니다.`;
  async function copy(){try{await navigator.clipboard.writeText(message);setNotice('문의 내용을 복사했어요. 문자나 상담 시 전달해 주세요. 아직 접수되거나 결제된 것은 아니에요.');}catch{setNotice('복사하지 못했어요. 아래 내용을 직접 선택해 복사하거나 전화로 문의해 주세요.');}}
  return <section id="plan-contact" className="my-5 scroll-mt-20 rounded-2xl border border-primary/20 bg-white p-4"><h2 className="font-bold">요금제 전환·인원 한도 문의</h2><p className="mt-2 text-sm leading-6 text-sub">현재는 운영팀 확인 후 청구서를 발행해요. 여기서 선택해도 요금제나 결제 금액은 바뀌지 않아요.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">희망 요금제<select value={plan} onChange={e=>setPlan(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-base">{plans.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label><label className="text-sm">결제 주기<select value={cycle} onChange={e=>setCycle(e.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-base">{['월간','6개월','1년','상담 후 결정'].map(value=><option key={value}>{value}</option>)}</select></label></div><textarea readOnly aria-label="전달할 문의 내용" value={message} rows={5} className="mt-3 w-full rounded-xl bg-bg p-3 text-base"/><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>void copy()} className="min-h-11 rounded-xl bg-primary px-4 font-bold text-white">문의 내용 복사</button><a href="tel:01090455699" className="inline-flex min-h-11 items-center rounded-xl border px-4 font-bold">운영팀 전화 문의</a></div><p className="mt-2 text-xs text-sub">010-9045-5699 · 연결되지 않으면 복사한 내용을 문자로 보내 주세요.</p>{notice&&<p role="status" className="mt-2 text-sm text-primary">{notice}</p>}</section>;
}
