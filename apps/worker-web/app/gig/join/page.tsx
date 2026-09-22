'use client';

import { Suspense } from 'react';
import { JoinInvite } from '@/components/invite/JoinInvite';

// 긱워커 초대 수락. 관리자 앱이 긱워커 근무지 초대 링크를 이 경로로 만든다.
export default function GigJoinPage() {
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">초대를 확인하고 있어요...</main>}><JoinInvite variant="gig" /></Suspense>;
}
