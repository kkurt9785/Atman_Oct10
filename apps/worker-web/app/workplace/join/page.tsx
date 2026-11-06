import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JoinInvite } from '@/components/invite/JoinInvite';
import { inviteMetadata } from '@/lib/install-manifest';

// 사업장 직원(병원·약국) 초대 수락. 긱워커 초대 링크가 여기로 오면 JoinInvite 가 /gig/join 으로 넘긴다.
// 카톡 미리보기는 '근무 초대', 이 화면에서 홈 화면에 추가하면 앱이 이 초대에서 열린다(아이폰은 앱 안에서 로그인 한 번).
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }): Promise<Metadata> {
  const { token } = await searchParams;
  return inviteMetadata('workplace', typeof token === 'string' ? token : null);
}

export default function JoinWorkplacePage() {
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">초대를 확인하고 있어요...</main>}><JoinInvite variant="medical" /></Suspense>;
}
