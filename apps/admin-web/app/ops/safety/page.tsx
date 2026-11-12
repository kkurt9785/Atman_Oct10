import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPlatformAdminSession } from '@/lib/platform-admin';
import { adminClient } from '@/lib/supabase';
import { ReviewForm } from './ReviewForm';
import { SuspendForm } from './SuspendForm';
export const dynamic='force-dynamic';
const reasons:Record<string,string>={harassment:'욕설·괴롭힘',spam:'광고·스팸',privacy:'개인정보 침해',other:'기타'};
// 직업안정법 §25 — 허위·과장 구인광고 모니터링: 근무자 신고 사유
const postingReasons:Record<string,string>={false_ad:'허위·과장 광고',wage_mismatch:'임금·조건 불일치',contact_mismatch:'연락처·주소 불일치',identity:'사업장 신원 의심',other:'기타'};
export default async function SafetyReviewPage({searchParams}:{searchParams:Promise<{closed?:string}>}) {
  if(!await getPlatformAdminSession())notFound();
  const closed=(await searchParams).closed==='1';
  const sb=adminClient();
  const statuses=closed?['resolved','dismissed']:['open','reviewing'];
  const [result,postings]=sb?await Promise.all([
    sb.from('chat_safety_reports').select('id,source,reason,note,message_snapshot,sender_label,status,resolution_note,content_hidden,created_at')
      .in('status',statuses).order('created_at',{ascending:!closed}).limit(100),
    // '*' — reporter_kind(20261105170000) 적용 전에도 목록이 깨지지 않게
    sb.from('job_posting_reports').select('*')
      .in('status',statuses).order('created_at',{ascending:!closed}).limit(100),
  ]):[null,null];
  // 신고된 사업장의 게재 중지 상태(컬럼이 아직 없으면 중지 안 된 것으로 보인다)
  const facilityIds=[...new Set((postings?.data??[]).map(report=>report.facility_id as string))];
  const {data:facilityRows}=sb&&facilityIds.length?await sb.from('facilities').select('*').in('id',facilityIds):{data:[]};
  const facilityById=new Map(((facilityRows??[]) as Array<{id:string;posting_suspended_at?:string|null;posting_suspended_reason?:string|null}>).map(row=>[row.id,row]));
  return <main className="mx-auto max-w-3xl px-4 pb-24">
    <Link href="/ops/facilities" className="inline-flex min-h-12 items-center font-bold text-primary">← 운영 관리</Link>
    <h1 className="text-2xl font-extrabold">신고 검토</h1>
    <p className="mt-2 text-sm text-sub">운영자 전용이에요. 신고자 정보는 상대방·사업장에 전달하지 않고, 신고 기록은 접수 후 1년 보관한 뒤 자동으로 지워요.</p>
    <nav className="my-4 flex gap-4"><Link className="min-h-11 py-3 underline" href="/ops/safety">처리 대기</Link><Link className="min-h-11 py-3 underline" href="/ops/safety?closed=1">처리 완료</Link></nav>

    <h2 className="mt-6 text-lg font-extrabold">공고·사업장 신고 <span className="text-sm font-bold text-sub">직업안정법 §25 모니터링</span></h2>
    {!postings||postings.error?<p role="alert" className="mt-2 rounded-xl bg-white p-4 text-sm">공고 신고를 불러오지 못했어요. 마이그레이션 20261103100000 이 적용됐는지 확인해 주세요.</p>:<>
      <p className="my-3 text-sm text-sub">{closed?'최근':'오래된 순으로'} 최대 100건 표시 · {postings.data.length}건</p>
      {!postings.data.length&&<p className="rounded-xl bg-white p-6">해당 신고가 없어요.</p>}
      {postings.data.map(report=><article key={report.id} className="mb-4 rounded-2xl border border-line bg-white p-4">
        <p className="text-sm font-bold">{postingReasons[report.reason]??report.reason} · {report.status}{report.reporter_kind==='facility_admin'&&<span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">사업장 관리자 신고</span>}</p>
        <p className="mt-1 text-xs text-sub">{new Date(report.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</p>
        <p className="mt-3 rounded-xl bg-bg p-3 text-sm"><b>{report.facility_name_snapshot}</b>{report.shift_snapshot?<><br/>공고: {report.shift_snapshot}</>:<><br/>사업장 전체에 대한 신고</>}</p>
        {report.note&&<p className="mt-3 whitespace-pre-wrap break-words text-sm">신고 설명: {report.note}</p>}
        {report.reporter_kind==='facility_admin'&&<p className="mt-2 text-xs text-sub">다른 사업장 관리자의 신고예요. 경쟁 사업장 간 보복 신고일 수 있어 사실 확인을 먼저 해 주세요.</p>}
        <ReviewForm id={report.id} initialStatus={report.status} initialNote={report.resolution_note} kind="posting"/>
        <SuspendForm facilityId={report.facility_id} suspendedAt={facilityById.get(report.facility_id)?.posting_suspended_at??null} suspendedReason={facilityById.get(report.facility_id)?.posting_suspended_reason??null}/>
      </article>)}
    </>}

    <h2 className="mt-10 text-lg font-extrabold">대화 신고</h2>
    {!result||result.error?<p role="alert" className="mt-2 rounded-xl bg-white p-4 text-sm">신고를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>:<>
      <p className="my-3 text-sm text-sub">{closed?'최근':'오래된 순으로'} 최대 100건 표시 · {result.data.length}건</p>
      {!result.data.length&&<p className="rounded-xl bg-white p-6">해당 신고가 없어요.</p>}
      {result.data.map(report=><article key={report.id} className="mb-4 rounded-2xl border border-line bg-white p-4">
        <p className="text-sm font-bold">{reasons[report.reason]} · {report.source==='match'?'공고 지원자 대화':'대화방'} · {report.status}</p>
        <p className="mt-1 text-xs text-sub">{new Date(report.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · {report.sender_label}</p>
        <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-bg p-3 [overflow-wrap:anywhere]">{report.message_snapshot}</blockquote>
        {report.note&&<p className="mt-3 whitespace-pre-wrap break-words text-sm">신고 설명: {report.note}</p>}
        {report.content_hidden&&<p className="mt-2 text-sm font-bold text-primary">메시지 숨김 처리됨</p>}
        <ReviewForm id={report.id} initialStatus={report.status} initialNote={report.resolution_note}/>
      </article>)}
    </>}
  </main>;
}
