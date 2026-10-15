import Link from 'next/link';
import { BlockSettings } from '@/components/safety/BlockSettings';
export default function SafetyPage() {
  return <main className="mx-auto max-w-lg px-5 py-6 pb-28"><Link href="/settings" className="inline-flex min-h-11 items-center text-[14px] font-bold text-sub">← 내 정보</Link><h1 className="mt-4 text-[26px] font-extrabold text-ink">대화 안전·차단 관리</h1><BlockSettings /></main>;
}
