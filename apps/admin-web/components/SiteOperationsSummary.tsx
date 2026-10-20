import Link from 'next/link';
import {getSiteSummary} from '@/lib/db/site-summary';
export async function SiteOperationsSummary({userId,facilityId}:{userId:string;facilityId:string}) {
  const href=(next:string)=>`/notifications/open?${new URLSearchParams({facility:facilityId,next})}`;
  try {
    const summary=await getSiteSummary(userId,facilityId);
    return <><dl className="mt-3 grid grid-cols-2 gap-2 text-sm">{[['출근 확인',summary.missing],['근무 중',summary.working],['퇴근 승인 대기',summary.pending],['긱 미정산 근무',summary.unpaid===null?'권한 없음':`${summary.unpaid}건`]].map(([label,value])=><div key={label} className="rounded-xl bg-bg p-3"><dt className="text-sub">{label}</dt><dd className="mt-1 font-bold">{value}{typeof value==='number'?'명':''}</dd></div>)}</dl><div className="mt-2 flex flex-wrap gap-3"><Link href={href('/timesheet')} className="inline-flex min-h-11 items-center font-bold text-primary">이 현장 근태 →</Link>{summary.unpaid!==null&&<Link href={href('/gig-pay')} className="inline-flex min-h-11 items-center font-bold text-primary">이 현장 지급 →</Link>}</div></>;
  } catch {return <div role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">현황을 불러오지 못했어요. 0건으로 처리하지 않았습니다. <Link className="inline-flex min-h-11 items-center font-bold" href={href('/')}>현장에서 다시 확인 →</Link></div>;}
}
