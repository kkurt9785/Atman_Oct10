'use client';
import { useRouter } from 'next/navigation';
import { GigworkerWorkspaceStart } from '@/app/setup/claim-facility/GigworkerWorkspaceStart';

// 병원·약국 관리자가 현장을 추가할 때는 긱 온보딩 문구('병원·약국 인증 없이…') 대신 의료 사업장용 한 줄을 보여 준다
const MEDICAL_INTRO = '지금 사업장과 따로 출퇴근 기준점을 둔 단기 근무 현장을 추가해요. 공고·직원·급여는 지금 사업장에서 그대로 관리해요.';

export function NewSiteForm({ medical = false }: { medical?: boolean }) {
  const router = useRouter();
  return <GigworkerWorkspaceStart onBack={() => router.push('/sites')} backLabel="← 사업장·현장 관리" eyebrow="현장 추가" intro={medical ? MEDICAL_INTRO : undefined} />;
}
