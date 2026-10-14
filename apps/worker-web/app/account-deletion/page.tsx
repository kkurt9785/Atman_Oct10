import Link from 'next/link';
import { COMPANY } from '@/components/legal/LegalDoc';
import { AccountDeletionAccess } from '@/components/settings/AccountDeletionAccess';

export const metadata = { title: '잇닿 계정 및 개인정보 삭제', robots: { index: false, follow: false } };

export default function AccountDeletionPage() {
  return <main className="mx-auto min-h-screen max-w-lg bg-white px-6 py-10">
    <p className="text-[14px] font-bold text-primary">잇닿 · {COMPANY.name}</p>
    <h1 className="mt-3 text-[26px] font-extrabold text-ink">계정 및 개인정보 삭제</h1>
    <p className="mt-3 text-[15px] leading-6 text-sub">앱을 설치하지 않아도 이 웹페이지에서 삭제를 진행할 수 있어요. 가입할 때 사용한 카카오 계정으로 본인을 확인한 뒤, 삭제 안내를 읽고 직접 요청해 주세요.</p>
    <AccountDeletionAccess />
    <section className="mt-8 space-y-3 text-[14px] leading-6 text-sub">
      <h2 className="text-[17px] font-bold text-ink">삭제되는 정보와 보관되는 기록</h2>
      <p>회원 탈퇴는 로그인 계정과 연락처·지급 계좌 등 개인정보를 정리합니다. 이미 한 근무의 근태·지급 내역과 근무 관련 대화, 동의 기록은 처리방침에 따라 탈퇴 후 3년 동안 보관한 뒤 익명 처리하거나 삭제합니다.</p>
      <p>앞으로 확정된 근무가 있으면 사업장과 정리가 필요합니다. 관리자 계정은 운영 중인 사업장을 먼저 종료해야 하며, 근무자 계정을 함께 사용하면 관리자 연결과 근무자 탈퇴를 각각 처리합니다.</p>
      <a href="https://admin.itdot.co.kr/settings?section=account" className="inline-flex min-h-11 items-center font-bold text-primary underline">관리자 계정 삭제 화면 열기</a>
      <h2 className="pt-3 text-[17px] font-bold text-ink">로그인하거나 삭제할 수 없다면</h2>
      <p>고객센터 <a href={`tel:${COMPANY.phone}`} className="font-bold text-primary underline">{COMPANY.phone}</a>로 계정 삭제를 요청해 주세요. 본인 확인에 필요한 절차와 보관 대상 기록을 안내합니다. 비밀번호나 전체 계좌번호는 보내지 마세요.</p>
      <Link href="/legal/privacy" className="inline-flex min-h-11 items-center font-bold text-primary underline">개인정보 처리방침 확인</Link>
    </section>
  </main>;
}
