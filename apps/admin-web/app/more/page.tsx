import Link from 'next/link';
import { Card } from '@/components/ui';
import { getAdminContext } from '@/lib/admin-auth';

const groups=[
  {title:'인력 운영',items:[['함께한 근무자','근무 이력이 있는 워커에게 다시 요청','/workforce'],['반복 일정·운영 알림','미충원·노쇼와 반복 모집 관리','/operations'],['메시지','지원자·근무자와 대화','/chats']]},
  {title:'근무 관리',items:[['휴가 관리','신청 승인과 사용 내역','/leave'],['출퇴근 인증 설정','위치·QR 인증 방식과 현장 QR','/attendance-qr'],['월 근태 내역','직원별 근무시간과 예외 기록','/attendance-history']]},
  {title:'서비스 관리',items:[['이용 요금','요금제와 청구 내역','/membership'],['사업장 설정','사업장 정보와 관리자 설정','/settings']]},
] as const;

export default async function MorePage(){
  const context=await getAdminContext();
  const visible=context?.canViewPayroll
    ? groups.map((g,i)=>i===2?{...g,items:[['급여·지급 관리','근무시간과 지급 상태 확인','/payroll'] as const,...g.items]}:g)
    : groups;
  return <main className="px-4"><div className="px-1 mt-2 mb-5"><p className="text-label font-bold text-primary">전체 메뉴</p><h1 className="mt-1 text-display font-extrabold text-ink">필요한 관리 기능을 모았어요</h1></div>
    <div className="space-y-5">{visible.map(group=><section key={group.title}><h2 className="px-1 mb-2 text-label font-bold text-sub">{group.title}</h2><Card className="divide-y divide-line p-0">{group.items.map(([label,description,href])=><Link key={href} href={href} className="flex items-center justify-between px-5 py-4 active:bg-bg"><div><p className="text-body font-bold text-ink">{label}</p><p className="mt-0.5 text-label text-sub">{description}</p></div><span className="ml-4 text-sub">→</span></Link>)}</Card></section>)}</div>
  </main>;
}
