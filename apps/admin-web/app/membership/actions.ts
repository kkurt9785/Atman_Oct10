'use server';
import { randomUUID } from 'crypto';
import { adminClient } from '@/lib/supabase';
import { requireFacilityAdmin } from '@/lib/facility';
import { findCreditTierByCharge } from '@/lib/billing';

export type CreateOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; message: string };

// 결제창을 열기 전에 주문 원장을 먼저 만든다 — 승인 단계에서 금액·시설 대조
export async function createPaymentOrder(amount: number): Promise<CreateOrderResult> {
  const session = await requireFacilityAdmin();
  const sb = adminClient();
  if (!sb || !session) return { ok: false, message: '관리자 인증이 필요해요.' };

  const tier = findCreditTierByCharge(amount);
  if (!tier) return { ok: false, message: '올바르지 않은 충전 금액이에요.' };

  const orderId = `atman_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const { error } = await sb.from('payment_orders').insert({
    order_id: orderId,
    org_id: session.facilityId,
    amount: tier.charge,
    credit: tier.credit,
    bonus: tier.bonus,
  });

  if (error) return { ok: false, message: '주문 생성에 실패했어요. 다시 시도해 주세요.' };
  return { ok: true, orderId };
}
