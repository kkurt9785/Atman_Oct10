'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
export default function AuthCallback() {
  const started=useRef(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(started.current)return;
    started.current=true;
    const params=new URLSearchParams(window.location.search);
    const hash=new URLSearchParams(window.location.hash.slice(1));
    const code=params.get('code');
    const denied=params.get('error') || hash.get('error');
    window.history.replaceState(null,'','/auth/callback');
    if(denied){setError('로그인이 취소되었거나 완료되지 않았어요. 다시 시작해 주세요.');return;}
    if(!code||!supabase){setError('로그인 연결이 만료되었어요. 로그인 버튼에서 다시 시작해 주세요.');return;}
    supabase.auth.exchangeCodeForSession(code).then(({data,error})=>{
      if(error||!data.session){setError('로그인을 시작한 브라우저에서 다시 시도해 주세요. 로그인 연결이 만료되었을 수 있어요.');return;}
      window.location.replace('/');
    }).catch(()=>setError('연결이 원활하지 않아요. 인터넷 연결을 확인하고 다시 로그인해 주세요.'));
  },[]);
  return <main className="auth"><a className="brand" href="/">HARAGURI<span>함께 챙기는 우리 일상</span></a><section className="auth-card"><h1>{error?'로그인을 다시 시작해 주세요':'로그인 중이에요'}</h1>{error?<><p role="alert">{error}</p><a className="primary auth-return" href="/">로그인 화면으로</a></>:<p role="status">로그인 정보를 확인하고 모임으로 이동합니다…</p>}</section></main>;
}
