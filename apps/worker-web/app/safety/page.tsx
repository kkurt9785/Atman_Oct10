import { BackButton } from '@/components/BackButton';
import { BlockSettings } from '@/components/safety/BlockSettings';

export default function SafetyPage() {
  return <main className="mx-auto min-h-screen max-w-lg bg-bg px-5 py-6">
    <BackButton href="/" label="이전 화면" anyPrevious />
    <h1 className="mt-4 text-[26px] font-extrabold text-ink">대화 안전·차단 관리</h1>
    <p className="mt-2 text-[14px] leading-6 text-sub">대화의 ‘신고·차단’에서 메시지를 신고할 수 있어요. 운영자가 내용을 확인하며 필요한 조치를 진행해요.</p>
    <BlockSettings />
  </main>;
}
