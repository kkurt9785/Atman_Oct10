import type { Metadata } from 'next';
import Link from 'next/link';

// QR 카드·카톡 링크의 목적지. 로그인 없이 열려야 하므로 정적 페이지로 유지한다.
export const metadata: Metadata = {
  title: '잇닿 — 병원·약국 인력, 앱에서 바로 구하세요',
  description:
    '병원·약국·요양병원의 빈 근무를 앱에서 바로 채우세요. 중개 수수료 0원, 사업장 직접 지급, 지원·출퇴근·근태·급여 검토까지 한 번에.',
  alternates: { canonical: 'https://itdot.co.kr/intro' },
  openGraph: {
    title: '잇닿 — 병원·약국 인력, 앱에서 바로 구하세요',
    description: '중개 수수료 0원. 공고 등록부터 실시간 알림·출퇴근 인증·월 근태·급여 검토까지 한 번에.',
    url: 'https://itdot.co.kr/intro',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const POINTS = [
  {
    icon: '📋',
    title: '공고부터 지원 수락까지 빠르게',
    body: '날짜와 시간만 정하면 공고가 열리고, 지원자 확인과 근무 확정은 같은 흐름에서 처리합니다.',
  },
  {
    icon: '📍',
    title: '출퇴근과 월 근태를 함께',
    body: '위치 우선 인증과 동적 QR 보완으로 출퇴근을 남기고, 지각·조퇴·휴가까지 한 달 단위로 확인합니다.',
  },
  {
    icon: '₩',
    title: '지급 확인까지 하나의 기록으로',
    body: '근무 기록을 바탕으로 지급을 검토하고, 사업장 직접 지급 후 워커의 입금 확인까지 이어집니다.',
  },
];

export default function IntroPage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="px-6 pt-14 pb-10 bg-gradient-to-b from-primary-light to-white">
        <p className="text-[13px] font-bold text-primary">병원·의원·요양병원·약국</p>
        <h1 className="mt-2 text-[28px] font-extrabold leading-[1.3] text-ink letter-tight">
          갑자기 빈 자리,
          <br />
          앱에서 바로 구합니다
        </h1>
        <p className="mt-3 text-[15px] leading-6 text-sub">
          간호사·간호조무사·약사 대타 인력을 등록된 워커에게 즉시 알리고,
          출퇴근 인증과 급여 자료까지 한 번에 정리하세요.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <a href="#admin-demo" className="flex h-12 items-center justify-center rounded-btn bg-primary text-[14px] font-extrabold text-white">
            1분 시연 보기
          </a>
          <a href="tel:01090455699" className="flex h-12 items-center justify-center rounded-btn border border-primary/30 bg-white text-[14px] font-extrabold text-primary">
            도입 상담
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-primary shadow-card">
            중개 수수료 0원
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-primary shadow-card">
            임금은 사업장 직접 지급
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-primary shadow-card">
            3개월 무료로 시작
          </span>
        </div>
      </header>

      <section id="admin-demo" className="border-y border-line bg-bg px-6 py-10 scroll-mt-4" aria-labelledby="admin-demo-title">
        <p className="text-[13px] font-bold text-primary">1분 시연</p>
        <h2 id="admin-demo-title" className="mt-1 text-[20px] font-extrabold text-ink">
          공고부터 지급 확인까지,
          <br />
          실제 화면으로 보세요
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-sub">
          빈 근무 공고를 만들고 워커를 수락한 뒤, 출퇴근 기록과 지급 확인까지 이어지는 관리자 흐름입니다.
        </p>
        <div className="mt-5 overflow-hidden rounded-card border border-line bg-black shadow-card">
          <video
            className="block aspect-[9/16] w-full bg-black"
            controls
            playsInline
            preload="metadata"
            poster="/demo/itdot-admin-demo-poster.jpg"
            aria-label="잇닿 관리자 서비스 시연 영상"
          >
            <source src="/demo/itdot-admin-demo.mp4" type="video/mp4" />
            브라우저가 동영상 재생을 지원하지 않습니다.
          </video>
        </div>
        <p className="mt-3 text-center text-[12px] text-tertiary">약 1분 10초 · 소리와 함께 보시면 흐름을 더 쉽게 이해할 수 있어요.</p>
      </section>

      <section className="px-6 py-10">
        <p className="text-[13px] font-bold text-primary">하나의 운영 흐름</p>
        <h2 className="mt-1 text-[20px] font-extrabold text-ink">사람을 구한 뒤의 일까지 연결합니다</h2>
        <div className="mt-5 space-y-3">
          {POINTS.map((p) => (
            <div key={p.title} className="flex gap-3 rounded-card bg-bg p-4">
              <span className="text-[20px] leading-none">{p.icon}</span>
              <div>
                <p className="text-[15px] font-bold text-ink">{p.title}</p>
                <p className="mt-1 text-[13px] leading-5 text-sub">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 pb-10">
        <h2 className="text-[20px] font-extrabold text-ink">지금은 함께 만드는 단계입니다</h2>
        <div className="mt-4 rounded-card border border-line p-5">
          <ul className="space-y-2.5 text-[13px] leading-5 text-sub">
            <li>· 도입 사업장은 <b className="text-ink">3개월 무료</b>로 쓰시고, 초기 세팅은 저희가 직접 해드립니다</li>
            <li>· 채용이 성사돼도 <b className="text-ink">중개 수수료는 0원</b>입니다</li>
            <li>· 임금은 사업장이 근무자에게 직접 지급합니다 (잇닿은 임금을 보관하지 않습니다)</li>
            <li>· 무료 기간이 끝나도 자동 결제되지 않습니다. 계속 쓰실지는 그때 정하시면 됩니다</li>
          </ul>
        </div>
      </section>

      <section className="px-6 pb-12">
        <div className="rounded-card bg-ink px-5 py-7 text-center">
          <p className="text-[15px] font-bold text-white">내 사업장 흐름으로 직접 설명해드릴게요</p>
          <p className="mt-2 text-[13px] leading-5 text-white/70">
            병원·약국·요양병원 중 어떤 곳인지 알려주시면, 실제 운영 흐름에 맞춰 초기 세팅과 시연을 도와드립니다.
          </p>
          <a
            href="tel:01090455699"
            className="mt-5 flex h-12 items-center justify-center rounded-btn bg-primary text-[15px] font-extrabold text-white"
          >
            도입 상담 · 010-9045-5699
          </a>
          <a
            href="#admin-demo"
            className="mt-2 flex h-12 items-center justify-center rounded-btn bg-white/10 text-[15px] font-bold text-white"
          >
            관리자 시연 영상 다시 보기
          </a>
        </div>
      </section>

      <section className="border-t border-line px-6 py-8">
        <p className="text-[15px] font-bold text-ink">일자리를 찾으시나요?</p>
        <p className="mt-1 text-[13px] leading-5 text-sub">
          간호사·간호조무사·약사·약국 사무직 공고를 확인하고 앱에서 바로 지원하세요.
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            href="/jobs"
            className="flex h-11 flex-1 items-center justify-center rounded-btn border border-primary/30 text-[14px] font-bold text-primary"
          >
            공고 보기
          </Link>
          <Link
            href="/worker-intro"
            className="flex h-11 flex-1 items-center justify-center rounded-btn bg-primary text-[14px] font-bold text-white"
          >
            워커 안내 보기
          </Link>
        </div>
      </section>

      <footer className="px-6 pb-12 pt-2">
        <p className="text-[11px] leading-5 text-tertiary">
          잇닿(itdot.co.kr) · 케셰르 · 대표 김기한 · 사업자등록번호 481-44-01177
          <br />
          경기도 수원시 권선구 경수대로 224
          <br />
          잇닿은 직업정보제공사업 형태로 구인·구직 정보를 제공하며, 특정 구인자와 구직자를
          직접 연결·추천하지 않으며 채용 성사에 연동된 수수료를 받지 않습니다.
        </p>
      </footer>
    </main>
  );
}
