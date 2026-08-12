import Link from 'next/link';

type Stage='recruit'|'applications'|'attendance'|'payroll';
const STEPS:[Stage,string,string][]=[
  ['recruit','모집','/shifts'],['applications','지원 확정','/applications'],
  ['attendance','근무 확인','/timesheet'],['payroll','지급','/payroll'],
];

export function OperationsFlow({active,compact=false}:{active?:Stage;compact?:boolean}){
  return <nav aria-label="모집부터 지급까지 운영 흐름" className={`rounded-2xl border border-line bg-white ${compact?'px-3 py-2.5':'px-4 py-3'} shadow-sm`}>
    {!compact&&<p className="mb-2 text-[11px] font-bold text-sub">한 흐름으로 이어서 처리하세요</p>}
    <div className="flex items-center justify-between gap-1">
      {STEPS.map(([key,label,href],index)=><span key={key} className="contents"><Link href={href} aria-current={active===key?'step':undefined} className={`whitespace-nowrap rounded-lg px-1.5 py-1 text-[11px] font-extrabold ${active===key?'bg-primary/10 text-primary':'text-sub'}`}>{index+1}. {label}</Link>{index<STEPS.length-1&&<span className="text-line" aria-hidden>→</span>}</span>)}
    </div>
  </nav>;
}
