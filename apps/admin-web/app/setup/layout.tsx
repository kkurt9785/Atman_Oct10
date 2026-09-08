import { redirect } from 'next/navigation';
import { getAdminSession, resolveDefaultFacilityId } from '@/lib/admin-auth';

// 셋업 플로우는 로그인 세션이 전제 — 없으면 검색이 조용히 빈 결과를
// 돌려줘서 "검색 결과가 없어요"로 오해하게 되므로 로그인으로 보낸다.
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/login');
  // 쿠키가 만료돼 여기로 떨어진 기존 원장은 검색이 아니라 홈으로 (사업장은 관리자당 1개라 재등록도 막힘)
  if (await resolveDefaultFacilityId(session.user.id)) redirect('/');
  return <>{children}</>;
}
