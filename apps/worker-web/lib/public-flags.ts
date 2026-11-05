import { supabase } from '@/lib/supabase';

// 직업안정법 §25(2026-12-10) — 체불사업주 명단 공개(근로기준법 §43의2)·산재 발생건수 공표(산업안전보건법 §10) 사업장이면 구직자에게 게재한다
export type PublicFlags = { public_flag_wage_arrears: boolean | null; public_flag_industrial_accident: boolean | null };
export const hasPublicFlag = (flags: PublicFlags | null | undefined) => Boolean(flags?.public_flag_wage_arrears || flags?.public_flag_industrial_accident);

// 공고 카드 배지용 — 사업장 id 묶음을 한 번에 읽는다. 실패하면 null(카드 배지만 빠지고, 지원 시트가 다시 확인한다)
export async function loadPublicFlags(facilityIds: string[]): Promise<Map<string, PublicFlags> | null> {
  const ids = [...new Set(facilityIds.filter(Boolean))].slice(0, 200);
  const map = new Map<string, PublicFlags>();
  if (!ids.length) return map;
  const { data, error } = await supabase.from('facilities').select('id, public_flag_wage_arrears, public_flag_industrial_accident').in('id', ids);
  if (error) return null;
  for (const row of (data ?? []) as Array<PublicFlags & { id: string }>) map.set(row.id, row);
  return map;
}
