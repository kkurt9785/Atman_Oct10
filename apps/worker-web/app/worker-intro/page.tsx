import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '간호사·약사 단기근무 시작하기 | 잇닿',
  description: '내 지역의 병원·약국·요양병원 단기근무 공고를 확인하고 지원하세요. 근무 확정부터 출퇴근, 지급 확인까지 잇닿에서 이어집니다.',
  alternates: { canonical: 'https://itdot.co.kr/worker-intro' },
  openGraph: {
    title: '내가 가능한 시간, 가까운 근무부터 | 잇닿',
    description: '간호사·간호조무사·약사·약국 사무직을 위한 단기근무 앱.',
    url: 'https://itdot.co.kr/worker-intro',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const STEPS = [
  { number: '01', title: '내 직군과 지역만 등록', body: '가능한 직군과 일할 지역을 한 번만 설정하세요. 내 조건에 맞는 병원·약국·요양병원 공고를 알려드려요.' },
  { number: '02', title: '조건을 보고 직접 지원', body: '근무시간·시급·업무·사업장 정보를 먼저 확인하고, 원하는 공고에만 지원합니다. 확정 전에는 언제든 지원 현황을 볼 수 있어요.' },
  { number: '03', title: '근무·출퇴근·지급 확인까지', body: '수락되면 채팅으로 안내를 받고, 근무 당일에는 앱에서 출퇴근합니다. 지급 완료 후에는 내역을 직접 확인할 수 있어요.' },
];

const ROLES = ['간호사', '간호조무사', '약사', '약국 전산·사무직'];

export default function WorkerIntroPage() {
  return <main className="min-h-screen bg-white pb-12">
    <header className="bg-gradient-to-b from-primary-light via-primary-light/30 to-white px-6 pb-11 pt-14">
      <p className="text-[13px] font-bold text-primary">의료·약국 단기근무 워커를 위한 잇닿</p>
      <h1 className="mt-2 text-[29px] font-extrabold leading-[1.3] tracking-[-0.04em] text-ink">
        내가 가능한 시간,
        <br />
        가까운 근무부터 시작해요
      </h1>
      <p className="mt-3 text-[15px] leading-6 text-sub">공고 확인부터 지원, 사업장 채팅, 출퇴근과 지급 확인까지 한 앱에서 이어집니다.</p>
      <div className="mt-5 flex flex-wrap gap-2">{ROLES.map((role) => <span key={role} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-primary shadow-card">{role}</span>)}</div>
      <div className="mt-7 grid grid-cols-2 gap-2">
        <Link href="/onboarding" className="flex h-12 items-center justify-center rounded-btn bg-primary text-[15px] font-extrabold text-white">워커 시작하기</Link>
        <Link href="/jobs" className="flex h-12 items-center justify-center rounded-btn border border-primary/30 bg-white text-[15px] font-extrabold text-primary">공고 먼저 보기</Link>
      </div>
    </header>

    <section className="px-6 py-9">
      <p className="text-[13px] font-bold text-primary">복잡한 절차 없이</p>
      <h2 className="mt-1 text-[21px] font-extrabold text-ink">세 단계면 충분해요</h2>
      <div className="mt-5 space-y-3">{STEPS.map((step) => <article key={step.number} className="rounded-card bg-bg p-4"><div className="flex items-start gap-3"><span className="pt-0.5 text-[12px] font-extrabold text-primary">{step.number}</span><div><h3 className="text-[15px] font-extrabold text-ink">{step.title}</h3><p className="mt-1 text-[13px] leading-5 text-sub">{step.body}</p></div></div></article>)}</div>
    </section>

    <section id="demo" className="border-y border-line bg-bg px-6 py-9" aria-labelledby="worker-demo-title">
      <p className="text-[13px] font-bold text-primary">1분 시연</p>
      <h2 id="worker-demo-title" className="mt-1 text-[21px] font-extrabold text-ink">등록 후, 내게 맞는 근무를 찾는 흐름</h2>
      <p className="mt-2 text-[13px] leading-5 text-sub">활동 지역 설정부터 공고 지원, 채팅, 출퇴근과 지급 확인까지 실제 워커 화면으로 확인해 보세요.</p>
      <div className="mt-5 overflow-hidden rounded-card border border-line bg-black shadow-card">
        <video className="block aspect-[9/16] w-full bg-black" controls playsInline preload="metadata" poster="/demo/itdot-worker-demo-poster.jpg" aria-label="잇닿 워커 서비스 시연 영상">
          <source src="/demo/itdot-worker-demo.mp4" type="video/mp4" />
          브라우저가 동영상 재생을 지원하지 않습니다.
        </video>
      </div>
      <p className="mt-3 text-center text-[12px] text-tertiary">약 1분 15초 · 소리와 함께 보시면 흐름을 더 쉽게 이해할 수 있어요.</p>
    </section>

    <section className="border-y border-line bg-white px-6 py-8">
      <p className="text-[13px] font-bold text-primary">근무 당일에도</p>
      <h2 className="mt-1 text-[21px] font-extrabold text-ink">버튼 한 번으로 출퇴근</h2>
      <div className="mt-4 rounded-card bg-primary/5 p-5"><p className="text-[15px] font-extrabold text-ink">위치 인증을 먼저 확인해요</p><p className="mt-2 text-[13px] leading-5 text-sub">사업장에 도착해 출근하기를 누르면 현재 위치를 확인합니다. 실내에서 GPS가 불안정하면 사업장 동적 QR로 보완할 수 있어요.</p><div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] font-bold"><span className="rounded-xl bg-white px-2 py-3 text-primary">출근하기</span><span className="rounded-xl bg-white px-2 py-3 text-primary">근무 중</span><span className="rounded-xl bg-white px-2 py-3 text-primary">퇴근하기</span></div></div>
    </section>

    <section className="px-6 py-9">
      <h2 className="text-[21px] font-extrabold text-ink">꼭 알아둘 점</h2>
      <ul className="mt-4 space-y-3 rounded-card border border-line p-5 text-[13px] leading-5 text-sub">
        <li><b className="text-ink">지원과 채용 확정은 다릅니다.</b> 사업장이 수락하면 근무가 확정되고 채팅으로 안내를 받을 수 있어요.</li>
        <li><b className="text-ink">자격은 채용 과정에서 사업장이 확인합니다.</b> 잇닿은 자격 심사기관이 아니며, 면허·원본·공식 조회 등은 사업장 내부 절차로 확인합니다.</li>
        <li><b className="text-ink">임금은 사업장이 직접 지급합니다.</b> 근무 완료 후 지급 상태를 앱에서 확인하고, 입금이 확인되면 완료로 표시할 수 있어요.</li>
      </ul>
    </section>

    <section className="px-6"><div className="rounded-card bg-ink px-5 py-7 text-center"><p className="text-[17px] font-extrabold text-white">내 지역 근무를 받아볼까요?</p><p className="mt-2 text-[13px] leading-5 text-white/70">프로필을 등록하면 조건에 맞는 새 공고와 근무 상태를 한 곳에서 확인할 수 있어요.</p><Link href="/onboarding" className="mt-5 flex h-12 items-center justify-center rounded-btn bg-primary text-[15px] font-extrabold text-white">워커로 시작하기</Link><Link href="/jobs" className="mt-2 flex h-11 items-center justify-center rounded-btn bg-white/10 text-[14px] font-bold text-white">로그인 없이 공고 보기</Link></div></section>

    <footer className="px-6 pb-4 pt-9 text-[11px] leading-5 text-tertiary">잇닿(itdot.co.kr) · 케셰르 · 대표 김기한 · 사업자등록번호 481-44-01177<br />경기도 수원시 권선구 경수대로 224<br />잇닿은 직업정보제공사업 형태로 구인·구직 정보를 제공합니다.</footer>
  </main>;
}
