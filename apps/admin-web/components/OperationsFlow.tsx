import Link from 'next/link';

type Stage='recruit'|'applications'|'attendance'|'payroll'|'staff'|'leave';
const STEPS:[Stage,string,string][]=[
  ['recruit','모집','/shifts'],['applications','지원 확정','/applications'],
  ['attendance','근무 확인','/timesheet'],['payroll','지급','/payroll'],
];
// 우리 직원을 관리하는 사업장(의원·약국)의 흐름 — 모집이 아니라 등록에서 시작한다
const STAFF_STEPS:[Stage,string,string][]=[
  ['staff','직원 등록','/staff'],['attendance','출퇴근','/timesheet'],
  ['leave','연차','/leave'],['payroll','급여','/payroll'],
];

export function OperationsFlow({active,compact=false,variant='recruit'}:{active?:Stage;compact?:boolean;variant?:'recruit'|'staff'}){
  const steps=variant==='staff'?STAFF_STEPS:STEPS;
  return <nav aria-label={variant==='staff'?'직원 등록부터 급여까지 운영 흐름':'모집부터 지급까지 운영 흐름'} className={`rounded-2xl border border-line bg-white ${compact?'px-3 py-0.5':'px-3 py-1'} shadow-sm`}>
    <div className="flex items-center justify-between gap-1">
      {steps.map(([key,label,href],index)=><span key={key} className="contents"><Link href={href} aria-current={active===key?'step':undefined} className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-1.5 text-[0.6875rem] font-extrabold ${active===key?'bg-primary/10 text-primary':'text-sub'}`}>{index+1}. {label}</Link>{index<steps.length-1&&<span className="text-line" aria-hidden>→</span>}</span>)}
    </div>
  </nav>;
}
