import Link from 'next/link';

export function ManageBackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="mt-1 inline-flex h-9 items-center gap-1 rounded-lg px-1 text-label font-bold text-sub active:text-primary" aria-label={`${label}으로 돌아가기`}>
    <span aria-hidden="true" className="text-[17px]">←</span><span>{label}</span>
  </Link>;
}
