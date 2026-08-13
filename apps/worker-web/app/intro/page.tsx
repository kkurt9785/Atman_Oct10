import type { Metadata } from 'next';
import Link from 'next/link';

// QR 카드·카톡 링크의 목적지. 로그인 없이 열려야 하므로 정적 페이지로 유지한다.
export const metadata: Metadata = {
  title: '잇닿 — 병원·약국 인력, 앱에서 바로 구하세요',
  description:
    '간호사·간호조무사·약사 대타 인력을 앱에서 바로 모집하세요. 매칭 수수료 0원, 임금은 사업장이 직접 지급, GPS·QR 출퇴근 인증까지.',
  alternates: { canonical: 'https://itdot.co.kr/intro' },
  openGraph: {
    title: '잇닿 — 병원·약국 인력, 앱에서 바로 구하세요',
    description: '매칭 수수료 0원. 공고 등록부터 출퇴근 인증·급여 정리까지 한 번에.',
    url: 'https://itdot.co.kr/intro',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const POINTS = [
  {
    icon: '📋',
    title: '공고 등록 1분',
    body: '날짜와 시간만 정하면 등록 끝. 조건에 맞는 워커에게 알림이 바로 갑니다.',
  },
  {
    icon: '🔔',
    title: '지원자 실시간 알림',
    body: '지원이 들어오면 원장님 휴대폰으로 바로 알려드려요. 자격 확인 후 수락하면 매칭 완료.',
  },
  {
    icon: '📍',
    title: 'GPS·QR·네트워크 3중 출퇴근',
    body: '위치 인증이 기본, 실내에서는 60초마다 바뀌는 QR이나 사업장 와이파이로 인증합니다.',
  },
  {
    icon: '₩',
    title: '근무시간 → 급여 자료 자동',
    body: '출퇴근 기록이 월 마감과 급여 검토 자료로 그대로 이어집니다. 급여는 원장님만 열람.',
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
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-primary shadow-card">
            매칭 수수료 0원
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-primary shadow-card">
            임금은 사업장 직접 지급
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-primary shadow-card">
            선정 사업장 3개월 무료 파일럿
          </span>
        </div>
      </header>

      <section className="px-6 py-10">
        <h2 className="text-[20px] font-extrabold text-ink">이런 게 됩니다</h2>
        <div className="mt-5 space-y-4">
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
        <h2 className="text-[20px] font-extrabold text-ink">요금</h2>
        <div className="mt-4 rounded-card border border-line p-5">
          <p className="text-[13px] text-sub">약국 월 59,000원 · 소형 의원 월 69,000원</p>
          <p className="mt-1 text-[24px] font-extrabold text-ink">
            월 59,000원<span className="text-[14px] font-bold text-sub">부터</span>
          </p>
          <ul className="mt-4 space-y-2 text-[13px] leading-5 text-sub">
            <li>· 채용 성사 수수료·중개 수수료 <b className="text-ink">0원</b></li>
            <li>· 임금은 사업장이 워커에게 직접 지급 (잇닿은 임금을 보관하지 않습니다)</li>
            <li>· 6개월 5%, 1년 10% 선결제 할인</li>
            <li>· 선정된 파일럿 사업장은 <b className="text-ink">3개월 무료 + 초기 세팅 대행</b>을 제공합니다</li>
          </ul>
        </div>
      </section>

      <section className="px-6 pb-12">
        <div className="rounded-card bg-ink px-5 py-7 text-center">
          <p className="text-[15px] font-bold text-white">먼저 3분만 이야기 나눠보세요</p>
          <p className="mt-2 text-[13px] leading-5 text-white/70">
            병원·약국 상황에 맞게 세팅까지 직접 도와드립니다.
          </p>
          <a
            href="tel:01090455699"
            className="mt-5 flex h-12 items-center justify-center rounded-btn bg-primary text-[15px] font-extrabold text-white"
          >
            010-9045-5699 전화하기
          </a>
          <a
            href="https://admin.itdot.co.kr"
            className="mt-2 flex h-12 items-center justify-center rounded-btn bg-white/10 text-[15px] font-bold text-white"
          >
            관리자 화면 보기
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
            href="/onboarding"
            className="flex h-11 flex-1 items-center justify-center rounded-btn bg-primary text-[14px] font-bold text-white"
          >
            워커 시작하기
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
