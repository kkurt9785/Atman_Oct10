import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JoinInvite } from '@/components/invite/JoinInvite';
import { inviteMetadata } from '@/lib/install-manifest';

// 긱워커 초대 수락. 관리자 앱이 긱워커 근무지 초대 링크를 이 경로로 만든다.
// 카톡 미리보기는 '근무 초대', 이 화면에서 홈 화면에 추가하면 앱이 이 초대에서 열린다(아이폰은 앱 안에서 로그인 한 번).
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }): Promise<Metadata> {
  const { token } = await searchParams;
  return inviteMetadata('gig', typeof token === 'string' ? token : null);
}

export default function GigJoinPage() {
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">초대를 확인하고 있어요...</main>}><JoinInvite variant="gig" /></Suspense>;
}
