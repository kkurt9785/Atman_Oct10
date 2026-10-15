'use client';
import Link from 'next/link';
import { Wordmark } from '@/components/brand/BrandMark';
import { ModeSwitch } from '@/components/worker/ModeSwitch';
import { WorkAgenda } from '@/components/worker/WorkAgenda';
import { PushNudge } from '@/components/worker/PushNudge';

export default function HomePage() {
  return <main className="px-5 pb-[calc(2rem+var(--demo-bar,0px))] pt-10">
    <header className="mb-6 flex items-center justify-between gap-3"><Wordmark size={22} /><ModeSwitch current="medical" /></header>
    <h1 className="text-2xl font-extrabold">오늘도, 잇닿과 함께</h1>
    <p className="mb-5 mt-2 text-sm text-sub">내 일정부터 확인하고 편하게 일을 시작하세요.</p>
    <WorkAgenda compact />
    <PushNudge />
    <section className="mt-6 rounded-2xl bg-primary/5 p-5"><h2 className="text-lg font-extrabold">나에게 맞는 근무 찾기</h2><p className="mt-2 text-sm leading-6 text-sub">설정한 지역을 함께 보고, 가능한 날짜·거리·시급으로 골라보세요.</p><Link href="/shifts" className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-ink font-bold text-white">근무 찾기 →</Link></section>
    <div className="mt-4 grid grid-cols-2 gap-3"><Link href="/cover" className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-white text-sm font-bold">대타 요청 보기</Link><Link href="/notifications" className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-white text-sm font-bold">내 소식 확인</Link></div>
  </main>;
}
