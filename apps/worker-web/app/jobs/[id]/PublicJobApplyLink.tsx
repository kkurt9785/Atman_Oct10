'use client';

export function PublicJobApplyLink({shiftId}:{shiftId:string}){
  function start(){
    window.localStorage.setItem('atman_auth_next',`/shifts?highlight=${shiftId}`);
    window.location.href='/onboarding?step=splash';
  }
  return <button type="button" onClick={start} className="flex h-12 w-full items-center justify-center rounded-btn bg-primary text-[15px] font-extrabold text-white">앱에서 지원하기</button>;
}
