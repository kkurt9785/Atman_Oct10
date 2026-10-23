'use client';

import { createContext, useContext, useState } from 'react';
import { InstallAppButton } from '@/components/InstallAppButton';

// TYPES·파서는 서버 페이지도 써야 해서 'use client' 밖(demo-selection-params.ts)에 둔다
import { TYPES, type DemoKind, type Role } from './demo-selection-params';
export { TYPES };

const Selection = createContext<{
  role: Role; kind: DemoKind; setRole: (role: Role) => void;
  setKind: (kind: DemoKind) => void; demoHref: string;
} | null>(null);

// 초기값은 서버가 넘긴다 — 하이드레이션 전(카톡 인앱·느린 망)에도 근무자 링크가 관리자 시연으로 열리지 않게
export function DemoSelectionProvider({ children, initialRole = 'admin', initialKind = 'hospital' }: { children: React.ReactNode; initialRole?: Role; initialKind?: DemoKind }) {
  const [role, setRole] = useState<Role>(initialRole);
  const [kind, setKind] = useState<DemoKind>(initialKind);
  const demoHref = role === 'admin' ? `https://admin.itdot.co.kr/login?demo=${kind}` : kind === 'gigworker' ? '/gig/demo' : '/demo';
  return <Selection.Provider value={{ role, kind, setRole, setKind, demoHref }}>{children}</Selection.Provider>;
}

export function useDemoSelection() {
  const selection = useContext(Selection);
  if (!selection) throw new Error('DemoSelectionProvider is required');
  return selection;
}

export function SelectedDemoActions({ dark = false }: { dark?: boolean }) {
  const { role, kind, demoHref } = useDemoSelection();
  const label = role === 'admin' ? `${TYPES.find(type => type.id === kind)?.label} 관리자` : kind === 'gigworker' ? '단기·초대 근무자' : '병원·약국 근무자';
  return <div className="mt-4" aria-label="선택한 시연 계속하기">
    <p className={`text-[13px] font-bold ${dark ? 'text-white' : 'text-ink'}`}>{label} 화면을 선택했어요</p>
    <a href={demoHref} className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-primary px-3 py-3 text-[14px] font-bold text-white">선택한 시연 계속하기 →</a>
    <p className={`my-3 text-[12px] leading-5 ${dark ? 'text-white/80' : 'text-sub'}`}>{role === 'admin' ? '자주 확인하는 근무·직원 관리를 홈 화면에서 바로 열어요.' : '내 근무표와 출퇴근 화면을 홈 화면에서 바로 열어요.'} 설치는 선택사항이에요.</p>
    {role === 'admin' ? <a href="https://admin.itdot.co.kr/login?install=1" className={`flex min-h-12 items-center justify-center rounded-xl border px-3 text-[14px] font-bold ${dark ? 'border-white/20 text-white' : 'border-line text-primary'}`}>관리자 앱 홈 화면에 추가 →</a> : <InstallAppButton label="워커 앱 홈 화면에 추가" dark={dark} />}
    <a href="#demo-start" className={`mt-2 block py-2 text-center text-[12px] ${dark ? 'text-white/80' : 'text-sub'}`}>역할·근무 유형 바꾸기 ↑</a>
  </div>;
}
