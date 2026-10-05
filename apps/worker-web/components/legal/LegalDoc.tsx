import type { ReactNode } from 'react';
import { BackButton } from '@/components/BackButton';

// 약관·개인정보 문서 공통 틀. 조항 번호와 시행일을 한 곳에서 맞춘다.
export const LEGAL_EFFECTIVE_DATE = '2026년 10월 2일';

export const COMPANY = {
  service: '잇닿(itdot.co.kr)',
  name: '케셰르',
  ceo: '김기한',
  brn: '481-44-01177',
  address: '경기도 수원시 권선구 경수대로 202',
  phone: '010-9045-5699',
};

export type LegalSection = { title: string; body: ReactNode };

export function LegalDoc({ title, intro, sections }: { title: string; intro?: ReactNode; sections: LegalSection[] }) {
  return (
    <main className="min-h-screen bg-white px-6 pb-12 pt-4">
      {/* 설정·가입·시작 화면 어디서 왔든 그 화면으로, 새 탭으로 열렸으면 탭을 닫는다 */}
      <BackButton href="/" anyPrevious />
      <h1 className="mt-4 text-[24px] font-extrabold text-ink">{title}</h1>
      <p className="mt-2 text-[13px] text-sub">시행일 {LEGAL_EFFECTIVE_DATE}</p>
      {intro && <div className="mt-5 text-[14px] leading-6 text-ink">{intro}</div>}
      <div className="mt-8 space-y-7">
        {sections.map((section, i) => (
          <section key={section.title}>
            <h2 className="text-[15px] font-extrabold text-ink">제{i + 1}조 ({section.title})</h2>
            <div className="mt-2 space-y-2 text-[14px] leading-6 text-ink [&_li]:ml-5 [&_li]:list-decimal [&_ul>li]:list-disc">{section.body}</div>
          </section>
        ))}
      </div>
      <footer className="mt-12 border-t border-line pt-5 text-[12px] leading-5 text-tertiary">
        {COMPANY.service} · {COMPANY.name} · 대표 {COMPANY.ceo} · 사업자등록번호 {COMPANY.brn}<br />
        {COMPANY.address} · 문의 {COMPANY.phone}
      </footer>
    </main>
  );
}
