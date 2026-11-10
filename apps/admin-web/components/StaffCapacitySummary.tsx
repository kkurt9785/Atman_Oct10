import Link from 'next/link';
import { getStaffCapacity } from '@/lib/billing-gates';
import { adminClient } from '@/lib/supabase';

export async function StaffCapacitySummary({facilityId}:{facilityId:string}) {
  try {
    const sb=adminClient();if(!sb)throw new Error();
    const capacity=await getStaffCapacity(sb,facilityId);
    return <section className="my-4 rounded-2xl border border-line bg-white p-4"><h2 className="text-sm font-bold">현장별 등록 한도 · {capacity.used}/{capacity.limit}명</h2><p className="mt-1 text-sm text-sub">추가 등록 가능 {capacity.remaining}명. 초대 대기·앱 미연결·미래 계약도 포함하며, 종료 처리했거나 계약 종료일이 지난 인원은 제외해요.</p>{capacity.trialEndsAt&&capacity.limitAfterTrial!==null&&capacity.limitAfterTrial<capacity.limit&&<p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[0.8125rem] leading-5 text-amber-900">무료 체험은 {capacity.trialEndsAt.replaceAll('-','.')}까지예요. 끝나면 무료 요금제({capacity.limitAfterTrial}명)로 바뀌어요. {capacity.used>capacity.limitAfterTrial?'지금 등록한 직원은 그대로 쓸 수 있지만 새로 추가할 수는 없어요.':'그 뒤로는 직원을 더 추가하기 어려워요.'} 계속 쓰려면 <Link href="/membership#plan-contact" className="font-bold underline underline-offset-2">이용 현황에서 문의</Link>해 주세요.</p>}{!capacity.remaining&&<Link href="/membership#plan-contact" className="mt-2 inline-flex min-h-11 items-center font-bold text-primary">한도·이용 문의 →</Link>}</section>;
  } catch {return <p role="status" className="my-4 rounded-xl bg-amber-50 p-3 text-sm">현재 등록 한도를 불러오지 못했어요. 새로고침 후 확인해 주세요. 등록 시 한도를 다시 검사해요.</p>;}
}
