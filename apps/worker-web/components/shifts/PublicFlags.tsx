'use client';

import { useEffect, useState } from 'react';
import { loadPublicFlags, type PublicFlags } from '@/lib/public-flags';

// 공표 정보 문구 — 사업장 시트·지원 시트(전문)와 공고 카드(배지)가 같은 사실을 같은 말로 쓴다. 사실만 적는다
export const PUBLIC_FLAG_TEXT = {
  wage: '고용노동부가 임금체불 사업주 명단을 공개 중인 사업장이에요. 지원 전 근무 조건과 지급 방식을 꼭 확인하세요.',
  accident: '최근 3년 산업재해 발생건수가 공표된 사업장이에요.',
} as const;

export function PublicFlagNotes({ flags }: { flags: PublicFlags | null }) {
  if (!flags) return null;
  return <>
    {flags.public_flag_wage_arrears && <p role="note" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-bold leading-5 text-amber-800">{PUBLIC_FLAG_TEXT.wage}</p>}
    {flags.public_flag_industrial_accident && <p role="note" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-bold leading-5 text-amber-800">{PUBLIC_FLAG_TEXT.accident}</p>}
  </>;
}

export function PublicFlagBadges({ flags }: { flags: PublicFlags | null | undefined }) {
  if (!flags) return null;
  return <>
    {flags.public_flag_wage_arrears && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">임금체불 명단 공개</span>}
    {flags.public_flag_industrial_accident && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">산재 공표 사업장</span>}
  </>;
}

// 사업장 하나의 배지(지도에서 고른 공고 카드처럼 한 곳만 보일 때)
export function FacilityFlagBadges({ facilityId }: { facilityId: string }) {
  const [flags, setFlags] = useState<PublicFlags | null>(null);
  useEffect(() => {
    let active = true;
    setFlags(null);
    void loadPublicFlags([facilityId]).then((map) => { if (active) setFlags(map?.get(facilityId) ?? null); }, () => undefined);
    return () => { active = false; };
  }, [facilityId]);
  if (!flags?.public_flag_wage_arrears && !flags?.public_flag_industrial_accident) return null;
  return <div className="mt-2 flex flex-wrap gap-1.5"><PublicFlagBadges flags={flags} /></div>;
}
