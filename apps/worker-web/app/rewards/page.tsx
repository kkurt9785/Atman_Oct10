'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Reward={id:string;amount:number;status:string;availableAt:string;note:string};
type Referral={id:string;name:string;status:string};
type Status={ok:boolean;eligible:boolean;isDemo:boolean;code:string;milestones:{profileVerified:boolean;firstApplied:boolean;firstShiftCompleted:boolean};rewards:Reward[];referrals:Referral[];message?:string};
const REFERRAL_STATUS:Record<string,string>={joined:'가입 완료',profile_verified:'프로필 인증',first_shift_completed:'첫 근무 완료',cancelled:'대상 제외'};
const REWARD_STATUS:Record<string,string>={qualified:'지급 검토 중',approved:'지급 예정',fulfilled:'지급 완료',cancelled:'대상 제외'};
const won=(n:number)=>`${n.toLocaleString('ko-KR')}원`;

function RewardsContent(){
  const router=useRouter();
  const params=useSearchParams();
  const [data,setData]=useState<Status|null>(null);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState('');
  const [copied,setCopied]=useState(false);

  useEffect(()=>{void (async()=>{
    const ref=params.get('ref');
    if(ref)window.localStorage.setItem('itdat_referral_code',ref);
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){
      window.localStorage.setItem('atman_auth_next','/rewards');
      router.replace('/onboarding');
      return;
    }
    const code=ref??window.localStorage.getItem('itdat_referral_code');
    if(code){
      const {error}=await supabase.rpc('accept_my_worker_referral',{p_code:code});
      if(error)setNotice(error.message.replace(/^.*?: /,''));
      else window.localStorage.removeItem('itdat_referral_code');
    }
    const {data:status,error}=await supabase.rpc('get_my_launch_reward_status');
    if(error)setNotice('리워드 현황을 불러오지 못했어요.');
    else setData(status as Status);
    setLoading(false);
  })();},[params,router]);

  async function share(){
    if(!data?.code)return;
    const url=`${window.location.origin}/rewards?ref=${data.code}`;
    const text='잇닿에서 간호 시프트를 확인해 보세요. 프로필 인증과 첫 근무 완료 혜택이 있어요.';
    if(navigator.share){
      try{await navigator.share({title:'잇닿 워커 초대',text,url});return;}catch{/* copy fallback */}
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    setCopied(true);window.setTimeout(()=>setCopied(false),1800);
  }

  if(loading)return <main className="min-h-screen bg-bg p-8 text-center text-sub">리워드 현황을 확인하고 있어요...</main>;
  if(!data?.ok)return <main className="min-h-screen bg-bg px-5 pt-12"><div className="rounded-2xl bg-white p-8 text-center"><b>{data?.message??'리워드를 확인할 수 없어요.'}</b></div></main>;

  const steps=[
    {label:'프로필·면허 인증',description:'활동지역과 면허 심사를 완료해요',done:data.milestones.profileVerified,reward:'커피 5천원'},
    {label:'첫 시프트 지원',description:'원하는 공고를 직접 선택해 지원해요',done:data.milestones.firstApplied,reward:null},
    {label:'첫 근무 완료',description:'출퇴근과 병원 근태 확정까지 완료해요',done:data.milestones.firstShiftCompleted,reward:'2만원'},
  ];
  const qualified=data.rewards.reduce((sum,row)=>row.status!=='cancelled'?sum+row.amount:sum,0);

  return <main className="min-h-screen bg-bg pb-28">
    <header className="bg-white px-5 pb-6 pt-12">
      <p className="text-[12px] font-bold text-primary">가입보다 실제 활동을 응원해요</p>
      <h1 className="mt-1 text-[26px] font-extrabold text-ink">잇닿 리워드</h1>
      <p className="mt-2 text-[13px] leading-5 text-sub">임금과 별개인 런칭 혜택이에요. 첫 근무 관련 리워드는 근태 확정 후 7일 동안 확인해요.</p>
    </header>

    {notice&&<p role="alert" className="mx-5 mt-4 rounded-xl bg-amber-50 p-3 text-[12px] font-bold text-amber-700">{notice}</p>}
    {!data.eligible&&<div className="mx-5 mt-4 rounded-2xl border border-line bg-white p-4"><p className="text-[13px] font-bold text-ink">{data.isDemo?'시연 계정에서는 진행 화면만 보여드려요':'런칭 신규 가입 혜택 대상이 아니에요'}</p><p className="mt-1 text-[12px] text-sub">친구 초대는 가능하며 실제 지급 조건은 캠페인 안내를 기준으로 해요.</p></div>}

    <section className="mx-5 mt-5 rounded-3xl bg-ink p-5 text-white">
      <p className="text-[12px] font-semibold text-white/60">확정·검토 중 리워드</p>
      <p className="mt-1 text-[28px] font-extrabold">{won(qualified)}</p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-primary" style={{width:`${steps.filter(s=>s.done).length/steps.length*100}%`}}/></div>
      <p className="mt-2 text-[11px] text-white/60">{steps.filter(s=>s.done).length}/{steps.length}단계 완료</p>
    </section>

    <section className="mx-5 mt-5 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-[17px] font-extrabold">첫 근무까지</h2>
      <div className="mt-4 space-y-4">{steps.map((step,index)=><div key={step.label} className="flex gap-3">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${step.done?'bg-success text-white':'bg-bg text-tertiary'}`}>{step.done?'✓':index+1}</div>
        <div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="text-[14px] font-bold">{step.label}</p>{step.reward&&<span className="shrink-0 text-[12px] font-bold text-primary">{step.reward}</span>}</div><p className="mt-0.5 text-[12px] text-sub">{step.description}</p></div>
      </div>)}</div>
      {!data.milestones.profileVerified?<Link href="/settings/profile" className="mt-5 flex h-11 items-center justify-center rounded-xl bg-primary text-[13px] font-extrabold text-white">프로필 완성하기</Link>:!data.milestones.firstApplied?<Link href="/shifts" className="mt-5 flex h-11 items-center justify-center rounded-xl bg-primary text-[13px] font-extrabold text-white">시프트 직접 찾아보기</Link>:null}
    </section>

    <section className="mx-5 mt-5 rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-[12px] font-bold text-primary">친구도 첫 근무를 완료하면</p>
      <h2 className="mt-1 text-[19px] font-extrabold">친구 5천원 · 나는 1만원</h2>
      <p className="mt-2 text-[12px] leading-5 text-sub">친구가 초대 링크로 신규 가입하고 첫 근무를 완료해야 리워드가 확정돼요.</p>
      <button onClick={share} className="mt-4 h-12 w-full rounded-xl bg-[#FEE500] text-[14px] font-extrabold text-[#191919]">{copied?'초대 링크를 복사했어요':'친구 초대 링크 공유'}</button>
      <p className="mt-2 text-center text-[11px] text-tertiary">자가 추천·중복 계정은 대상에서 제외돼요.</p>
      {data.referrals.length>0&&<div className="mt-4 border-t border-line pt-3"><p className="text-[13px] font-bold">초대 현황</p><div className="mt-2 divide-y divide-line">{data.referrals.map(row=><div key={row.id} className="flex justify-between py-2.5 text-[12px]"><span>{row.name}</span><b className={row.status==='first_shift_completed'?'text-success':'text-primary'}>{REFERRAL_STATUS[row.status]??row.status}</b></div>)}</div></div>}
    </section>

    {data.rewards.length>0&&<section className="mx-5 mt-5 rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-[15px] font-extrabold">리워드 내역</h2><div className="mt-2 divide-y divide-line">{data.rewards.map(row=><div key={row.id} className="flex items-center justify-between py-3"><div><p className="text-[13px] font-bold">{row.note}</p><p className="mt-0.5 text-[11px] text-sub">{REWARD_STATUS[row.status]??row.status}</p></div><b className="text-[14px] text-primary">+{won(row.amount)}</b></div>)}</div></section>}

    <details className="mx-5 mt-5 rounded-2xl border border-line bg-white p-4 text-[12px] text-sub">
      <summary className="cursor-pointer font-bold text-ink">지급 조건 확인</summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-4 leading-5"><li>신규 가입·휴대전화 등록·면허 심사 완료가 필요해요.</li><li>첫 근무는 정상 체크아웃과 병원 근태 확정 후 인정돼요.</li><li>취소·노쇼·분쟁 기록은 검토 또는 지급 제외될 수 있어요.</li><li>캠페인 예산 소진 시 사전 안내 후 종료될 수 있어요.</li></ul>
    </details>
  </main>;
}

export default function RewardsPage(){
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">리워드를 불러오고 있어요...</main>}><RewardsContent/></Suspense>;
}
