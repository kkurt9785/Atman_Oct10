'use client';
import Link from 'next/link';
import { Wordmark } from '@/components/brand/BrandMark';
import { ModeSwitch } from '@/components/worker/ModeSwitch';
import { WorkAgenda } from '@/components/worker/WorkAgenda';
import { PushNudge } from '@/components/worker/PushNudge';
import { useStaffFirst } from '@/lib/use-staff-first';
import { BetaGuide } from '@/components/guide/BetaGuide';

export default function HomePage() {
  // 직원으로 연결된 사람은 출퇴근·휴가·급여가 먼저다. 근무 찾기는 없애지 않고 맨 아래에 접어 둔다(2026-11-10 치과 QA P1-12).
  // 직원 연결이 없는 사람은 지금까지와 똑같은 화면을 본다. 판정 전(null)에는 아래 카드를 비워 둔다 — 구직 카드가 번쩍였다 바뀌지 않게.
  const staffFirst = useStaffFirst();
  return <main className="px-5 pb-[calc(2rem+var(--demo-bar,0px))] pt-10">
    <header className="mb-6 flex items-center justify-between gap-3"><Wordmark size={22} /><ModeSwitch current="medical" /></header>
    <h1 className="text-2xl font-extrabold">오늘도, 잇닿과 함께</h1>
    <p className="mb-5 mt-2 text-sm text-sub">내 일정부터 확인하고 편하게 일을 시작하세요.</p>
    <WorkAgenda compact />
    {staffFirst === true && <>
      <BetaGuide id="worker-home" title="출퇴근·휴가는 이렇게 해요" steps={[
        { text: '근무지에 도착하면 출퇴근 화면에서 [출근하기]를 1초 길게 눌러요.', href: '/workplace', cta: '출퇴근 열기' },
        { text: '위치가 안 잡히면 접수대나 관리자 화면에 뜬 출퇴근 QR을 폰 카메라로 비춰요.' },
        { text: '휴가는 앱에서 신청해요. 관리자가 승인하면 반영돼요.', href: '/workplace?tab=leave', cta: '휴가 신청' },
      ]} />
      <nav aria-label="내 직장 바로가기" className="mt-4 grid grid-cols-3 gap-3">
        <Link href="/workplace?tab=leave" className="flex min-h-[72px] flex-col items-center justify-center rounded-2xl border border-line bg-white px-2 text-center"><b className="text-sm font-extrabold text-ink">휴가</b><span className="mt-1 text-[11px] text-sub">신청·잔여</span></Link>
        <Link href="/earnings" className="flex min-h-[72px] flex-col items-center justify-center rounded-2xl border border-line bg-white px-2 text-center"><b className="text-sm font-extrabold text-ink">급여</b><span className="mt-1 text-[11px] text-sub">이번 달 예상</span></Link>
        <Link href="/notifications" className="flex min-h-[72px] flex-col items-center justify-center rounded-2xl border border-line bg-white px-2 text-center"><b className="text-sm font-extrabold text-ink">소식</b><span className="mt-1 text-[11px] text-sub">공지·알림</span></Link>
      </nav>
      <PushNudge staffFirst />
      <details className="mt-6 rounded-2xl bg-white">
        <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 text-sm font-bold text-sub">다른 근무도 찾아보기<span aria-hidden="true">＋</span></summary>
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Link href="/shifts" className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-white text-sm font-bold">근무 찾기</Link>
          <Link href="/cover" className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-white text-sm font-bold">대타 요청 보기</Link>
        </div>
      </details>
    </>}
    {staffFirst === false && <>
      <PushNudge />
      <section className="mt-6 rounded-2xl bg-primary/5 p-5"><h2 className="text-lg font-extrabold">나에게 맞는 근무 찾기</h2><p className="mt-2 text-sm leading-6 text-sub">설정한 지역을 함께 보고, 가능한 날짜·거리·시급으로 골라보세요.</p><Link href="/shifts" className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-ink font-bold text-white">근무 찾기 →</Link></section>
      <div className="mt-4 grid grid-cols-2 gap-3"><Link href="/cover" className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-white text-sm font-bold">대타 요청 보기</Link><Link href="/notifications" className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-white text-sm font-bold">내 소식 확인</Link></div>
    </>}
  </main>;
}
