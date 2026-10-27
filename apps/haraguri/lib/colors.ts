import type { Member } from './model';

// One stable colour per family member (TimeTree/카카오캘린더 convention): order of joining decides the swatch.
export const MEMBER_PALETTE: { bg: string; fg: string }[] = [
  { bg: '#efe0cf', fg: '#785b40' }, { bg: '#dbe7dc', fg: '#3e6958' }, { bg: '#e3e4f3', fg: '#4f5a9c' },
  { bg: '#f6dede', fg: '#9b4a4a' }, { bg: '#fbeccd', fg: '#8a6a1f' }, { bg: '#d9ecee', fg: '#2f6f78' },
];
export function memberColor(members: Member[], userId: string | null | undefined) {
  const index = members.findIndex(m => m.user_id === userId);
  return index < 0 ? { bg: '#ececec', fg: '#6b746d' } : MEMBER_PALETTE[index % MEMBER_PALETTE.length];
}
