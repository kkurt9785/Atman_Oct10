'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { InstallAppButton } from '@/components/InstallAppButton';

export const TYPES = [
  { id: 'hospital', label: '병원·의원' },
  { id: 'pharmacy', label: '약국' },
  { id: 'care', label: '요양병원' },
  { id: 'gigworker', label: '단기·행사' },
] as const;
type DemoKind = typeof TYPES[number]['id'];
type Role = 'admin' | 'worker';
const Selection = createContext<{
  role: Role; kind: DemoKind; setRole: (role: Role) => void;
  setKind: (kind: DemoKind) => void; demoHref: string;
} | null>(null);

export function DemoSelectionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>('admin');
  const [kind, setKind] = useState<DemoKind>('hospital');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('role') === 'worker') setRole('worker');
    const selected = params.get('kind');
    if (TYPES.some(type => type.id === selected)) setKind(selected as DemoKind);
  }, []);
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
