'use client';

import { Suspense } from 'react';
import { JoinInvite } from '@/components/invite/JoinInvite';

// 사업장 직원(병원·약국) 초대 수락. 긱워커 초대 링크가 여기로 오면 JoinInvite 가 /gig/join 으로 넘긴다.
export default function JoinWorkplacePage() {
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">초대를 확인하고 있어요...</main>}><JoinInvite variant="medical" /></Suspense>;
}
