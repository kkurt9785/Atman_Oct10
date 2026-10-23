import { beforeEach, describe, expect, it, vi } from 'vitest';

// GPT 10/23 #1 — 시연 사업장은 결제 버튼과 별개로 서버에서도 청구서·결제 주문·카드 승인을 만들지 않는다
const mocks = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), confirmToss: vi.fn(), tables: [] as string[] }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../admin-web/node_modules/next/cache.js', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../admin-web/lib/admin-auth', () => ({ requireAdminContext: mocks.context }));
vi.mock('@/lib/admin-auth', () => ({ requireAdminContext: mocks.context }));
vi.mock('../../../admin-web/lib/toss', () => ({ confirmTossPayment: mocks.confirmToss, getTossPayment: vi.fn(), assertTossPaymentMatches: vi.fn(), TossApiError: class extends Error {} }));
const client = { from: (table: string) => { mocks.tables.push(table); return mocks.from(table); } };
vi.mock('../../../admin-web/lib/supabase', () => ({ adminClient: () => client }));
vi.mock('@/lib/supabase', () => ({ adminClient: () => client }));
vi.mock('@/lib/date', () => ({ todayKST: () => '2026-10-23' }));
// 라우트의 '@/lib/demo-guard' 는 admin 경로 — 실제 가드를 그대로 연결한다(가짜 아님)
vi.mock('@/lib/demo-guard', () => import('../../../admin-web/lib/demo-guard'));

// admin 쪽 '@/…' 별칭은 admin tsconfig 에서만 맞으므로 경로를 변수로 둬 이 앱 tsc 범위 밖에서 불러온다
const servicePath = '../../../admin-web/lib/payment-service';
const routePath = '../../../admin-web/app/api/addons/job-posting/route';
const guardPath = '../../../admin-web/lib/demo-guard';
const { createPaymentOrder, confirmPaymentOrder } = await import(servicePath);
const { POST: buyJobPosting } = await import(routePath);
const { DEMO_BLOCKED_MESSAGE } = await import(guardPath);

function chain(result: unknown) {
  const q: any = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'update', 'insert']) q[m] = () => q;
  q.maybeSingle = async () => result; q.single = async () => result;
  return q;
}
function facilityIsDemo(isDemo: boolean, order?: Record<string, unknown>) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'facilities') return chain({ data: { is_demo: isDemo }, error: null });
    if (table === 'payment_orders' && order) return chain({ data: order, error: null });
    return chain({ data: null, error: { message: 'should not be reached in demo' } });
  });
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.tables.length = 0;
  mocks.context.mockResolvedValue({ facilityId: 'demo-facility', user: { id: 'admin' }, accessRole: 'super' });
});

describe('시연 사업장 결제 서버 차단', () => {
  it('결제 주문을 만들기 전에 막고 청구서도 읽지 않는다', async () => {
    facilityIsDemo(true);
    await expect(createPaymentOrder('invoice-1')).rejects.toThrow(DEMO_BLOCKED_MESSAGE);
    expect(mocks.tables).toEqual(['facilities']);
  });
  it('주문이 있어도 토스 승인 요청 전에 막는다', async () => {
    facilityIsDemo(true, { id: 'o1', order_id: 'atman_1', facility_id: 'demo-facility', order_type: 'service_invoice', service_invoice_id: 'inv', amount: 9900, status: 'ready' });
    await expect(confirmPaymentOrder({ paymentKey: 'pk', orderId: 'atman_1', amount: 9900 })).rejects.toThrow(DEMO_BLOCKED_MESSAGE);
    expect(mocks.confirmToss).not.toHaveBeenCalled();
  });
  it('추가 공고 청구서는 403 으로 거절하고 요금제·청구서 표를 건드리지 않는다', async () => {
    facilityIsDemo(true);
    const response = await buyJobPosting();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: DEMO_BLOCKED_MESSAGE });
    expect(mocks.tables).toEqual(['facilities']);
  });
  it('실제 사업장은 차단 없이 다음 단계(청구서 조회)로 간다', async () => {
    facilityIsDemo(false);
    await expect(createPaymentOrder('invoice-1')).rejects.toThrow('결제 가능한 서비스 청구서를 찾을 수 없어요.');
    expect(mocks.tables).toEqual(['facilities', 'service_invoices']);
  });
});
