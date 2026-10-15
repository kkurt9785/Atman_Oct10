import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPlatformAdminSession } from '@/lib/platform-admin';
import { adminClient } from '@/lib/supabase';
import { ReviewForm } from './ReviewForm';
export const dynamic='force-dynamic';
const reasons:Record<string,string>={harassment:'욕설·괴롭힘',spam:'광고·스팸',privacy:'개인정보 침해',other:'기타'};
export default async function SafetyReviewPage({searchParams}:{searchParams:Promise<{closed?:string}>}) {
  if(!await getPlatformAdminSession())notFound();
  const closed=(await searchParams).closed==='1';
  const sb=adminClient();
  const result=sb?await sb.from('chat_safety_reports').select('id,source,reason,note,message_snapshot,sender_label,status,resolution_note,content_hidden,created_at')
    .in('status',closed?['resolved','dismissed']:['open','reviewing']).order('created_at',{ascending:closed?false:true}).limit(100):null;
  return <main className="mx-auto max-w-3xl px-4 pb-24">
    <Link href="/ops/facilities" className="inline-flex min-h-12 items-center font-bold text-primary">← 운영 관리</Link>
    <h1 className="text-2xl font-extrabold">대화 신고 검토</h1>
    <p className="mt-2 text-sm text-sub">운영자 전용입니다. 신고자 정보는 상대방에게 전달하지 않으며, 신고 기록은 접수 후 1년 보관합니다.</p>
    <nav className="my-4 flex gap-4"><Link className="min-h-11 py-3 underline" href="/ops/safety">처리 대기</Link><Link className="min-h-11 py-3 underline" href="/ops/safety?closed=1">처리 완료</Link></nav>
    {!result||result.error?<p role="alert">신고를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>:<>
      <p className="mb-3 text-sm text-sub">{closed?'최근':'오래된 순으로'} 최대 100건 표시 · {result.data.length}건</p>
      {!result.data.length&&<p className="rounded-xl bg-white p-6">해당 신고가 없어요.</p>}
      {result.data.map(report=><article key={report.id} className="mb-4 rounded-2xl border border-line bg-white p-4">
        <p className="text-sm font-bold">{reasons[report.reason]} · {report.source==='match'?'근무 대화':'워크룸'} · {report.status}</p>
        <p className="mt-1 text-xs text-sub">{new Date(report.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · {report.sender_label}</p>
        <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-bg p-3 [overflow-wrap:anywhere]">{report.message_snapshot}</blockquote>
        {report.note&&<p className="mt-3 whitespace-pre-wrap break-words text-sm">신고 설명: {report.note}</p>}
        {report.content_hidden&&<p className="mt-2 text-sm font-bold text-primary">메시지 숨김 처리됨</p>}
        <ReviewForm id={report.id} initialStatus={report.status} initialNote={report.resolution_note}/>
      </article>)}
    </>}
  </main>;
}
