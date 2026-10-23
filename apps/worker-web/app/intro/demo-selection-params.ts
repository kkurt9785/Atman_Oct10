// /intro 의 ?role=&kind= 해석 — 서버 페이지(page.tsx)와 클라이언트 선택(DemoSelection.tsx)이 같이 쓴다
export const TYPES = [
  { id: 'hospital', label: '병원·의원' },
  { id: 'pharmacy', label: '약국' },
  { id: 'care', label: '요양병원' },
  { id: 'gigworker', label: '단기·행사' },
] as const;
export type DemoKind = typeof TYPES[number]['id'];
export type Role = 'admin' | 'worker';

/** QR·공유 링크의 ?role=&kind= — 서버에서 읽어 첫 HTML 의 선택과 CTA 주소를 맞춘다. 대소문자·공백·중복 파라미터 허용 */
export function parseDemoSelection(role: unknown, kind: unknown): { role: Role; kind: DemoKind } {
  const first = (value: unknown) => String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim().toLowerCase();
  const r = first(role);
  const k = first(kind);
  return { role: r === 'worker' ? 'worker' : 'admin', kind: TYPES.find(type => type.id === k)?.id ?? 'hospital' };
}
