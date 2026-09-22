'use client';

import { Suspense } from 'react';
import { WorkerWorkroom } from '@/components/workroom/WorkerWorkroom';

export default function WorkerWorkroomPage() {
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">워크룸을 불러오고 있어요...</main>}><WorkerWorkroom variant="medical"/></Suspense>;
}
