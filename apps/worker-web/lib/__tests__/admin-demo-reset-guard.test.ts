import { beforeEach, describe, expect, it, vi } from 'vitest';

// 결정 4a — 공개 시연 계정(@demo.atman.co.kr)은 '시연 초기화'를 서버에서도 막는다. 방문자가 같이 써서 한 사람이 누르면 다른 시연이 끊긴다.
// 막힐 때는 DB(조회·RPC·알림)를 전혀 건드리지 않고 운영 화면 ?error= 배너로 돌려보낸다.
const mocks = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), rpc: vi.fn(), redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }) }));
// vi.mock 은 파일 맨 위로 끌어올려진다 — 팩토리 안에서는 vi.hoisted 값만 쓴다
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock('../../../admin-web/node_modules/next/navigation.js', () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../admin-web/node_modules/next/cache.js', () => ({ revalidatePath: vi.fn() }));
// admin 쪽 '@/…' 별칭은 이 앱 루트로 풀린다 — 액션이 부르는 모듈을 모두 끊고, 판정 함수만 진짜를 쓴다
vi.mock('@/lib/admin-auth', () => ({ requireAdminContext: mocks.context }));
vi.mock('@/lib/supabase', () => ({ adminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock('@/lib/pay', () => ({ calcEstimatedShiftPay: vi.fn(), hourlyWageError: vi.fn() }));
vi.mock('@/lib/billing-gates', () => ({ consumePlanUsage: vi.fn(), releasePlanUsage: vi.fn(), requirePlanFeature: vi.fn() }));
vi.mock('@/lib/date', () => ({ todayKST: () => '2026-11-05' }));
vi.mock('@/lib/notify-nudge', () => ({ nudgeNotificationDispatch: vi.fn() }));
vi.mock('@/lib/db/operations', () => ({ getWorkforceRecommendations: vi.fn() }));
vi.mock('@/lib/posting-gate', () => ({ loadPublicPostingBlock: vi.fn(), shiftStartPassed: vi.fn() }));
vi.mock('@/lib/replacement-window', () => import('../../../admin-web/lib/replacement-window'));
vi.mock('@/lib/public-demo', () => import('../../../admin-web/lib/public-demo'));

const actionsPath = '../../../admin-web/app/operations/actions';
const { resetFacilityLiveDemoAction } = await import(actionsPath);
const { PUBLIC_DEMO_RESET_BLOCKED } = await import('../../../admin-web/lib/public-demo');

describe('공개 시연 계정 시연 초기화 차단', () => {
  beforeEach(() => { mocks.from.mockReset(); mocks.rpc.mockReset(); mocks.redirect.mockClear(); });
  it.each(['sales-demo-1@demo.atman.co.kr', 'Sales-Demo-3@DEMO.atman.co.kr'])('%s 는 DB를 건드리지 않고 운영 화면 안내로 돌아간다', async (email) => {
    mocks.context.mockResolvedValue({ facilityId: 'demo-hospital', accessRole: 'super', user: { id: 'u', email } });
    await expect(resetFacilityLiveDemoAction()).rejects.toThrow('REDIRECT:/operations?error=');
    expect(mocks.redirect).toHaveBeenCalledWith(`/operations?error=${encodeURIComponent(PUBLIC_DEMO_RESET_BLOCKED)}`);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('영업 담당 개인 계정은 기존 검사(데모 시설 여부)로 넘어간다', async () => {
    mocks.context.mockResolvedValue({ facilityId: 'real', accessRole: 'owner', user: { id: 'u', email: 'owner@hospital.kr' } });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_demo: false, business_registration_number: 'X' } }) }) }) });
    await expect(resetFacilityLiveDemoAction()).rejects.toThrow('세 영업 데모 시설에서만');
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
