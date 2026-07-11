
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from './admin-auth';
import { adminClient } from './supabase';
import {
  assertTossPaymentMatches,
  confirmTossPayment,
  getTossPayment,
  TossApiError,
  type TossPayment,
} from './toss';

type PaymentOrderRow = {
  id: string;
  order_id: string;
  facility_id: string;
  requested_by: string;
  tier_id: number | null;
  order_name: string;
  amount: number;
  base_credit: number;
  bonus_credit: number;
  status: string;
  provider_payment_key: string | null;
  idempotency_key: string;
  order_type: 'legacy_credit' | 'service_invoice';
  service_invoice_id: string | null;
};

export type PaymentConfirmation = {
  invoiceId: string;
  alreadyProcessed: boolean;
  orderId: string;
};

function getServiceClient() {
  const sb = adminClient();
  if (!sb) throw new Error('Supabase 서버 설정을 확인해 주세요.');
  return sb;
}

export async function createPaymentOrder(invoiceId: string) {
  const context = await requireAdminContext(['owner', 'super']);
  const sb = getServiceClient();
  const { data: invoice, error: invoiceError } = await sb.from('service_invoices')
    .select('id,invoice_number,total_amount,status').eq('id', invoiceId)
    .eq('facility_id', context.facilityId).in('status', ['issued','overdue']).maybeSingle();
  if (invoiceError || !invoice) throw new Error('결제 가능한 서비스 청구서를 찾을 수 없어요.');
  const orderId = `atman_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const idempotencyKey = `confirm:${randomUUID()}`;
  const orderName = `잇닿 SaaS 이용료 ${invoice.invoice_number}`;

  const { data, error } = await sb
    .from('payment_orders')
    .insert({
      order_id: orderId,
      facility_id: context.facilityId,
      requested_by: context.user.id,
      tier_id: null,
      order_name: orderName,
      amount: invoice.total_amount,
      base_credit: 0,
      bonus_credit: 0,
      order_type: 'service_invoice',
      service_invoice_id: invoice.id,
      status: 'ready',
      idempotency_key: idempotencyKey,
    })
    .select('order_id, order_name, amount, service_invoice_id')
    .single();

  if (error || !data) throw new Error(error?.message || '결제 주문 생성에 실패했어요.');
  return {
    orderId: data.order_id as string,
    orderName: data.order_name as string,
    amount: data.amount as number,
    invoiceId: data.service_invoice_id as string,
  };
}

async function getOwnedOrder(orderId: string): Promise<PaymentOrderRow> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('payment_orders')
    .select('*')
    .eq('order_id', orderId)
    .eq('facility_id', context.facilityId)
    .eq('requested_by', context.user.id)
    .maybeSingle();
  if (error || !data) throw new Error('현재 관리자 계정의 결제 주문을 찾을 수 없어요.');
  return data as PaymentOrderRow;
}

async function finalize(order: PaymentOrderRow, payment: TossPayment): Promise<PaymentConfirmation> {
  assertTossPaymentMatches(payment, {
    paymentKey: payment.paymentKey,
    orderId: order.order_id,
    amount: order.amount,
  });
  if (payment.status !== 'DONE') throw new Error(`결제 상태가 완료가 아니에요 (${payment.status}).`);

  const sb = getServiceClient();
  if (order.order_type !== 'service_invoice' || !order.service_invoice_id) throw new Error('레거시 크레딧 결제는 중단됐어요.');
  const { data, error } = await sb.rpc('finalize_service_invoice_payment', {
    p_order_id: order.order_id,
    p_payment_key: payment.paymentKey,
    p_provider_status: payment.status,
    p_provider_payload: payment,
  });
  if (error) throw new Error(error.message || '서비스 청구서 결제 반영에 실패했어요.');

  const result = (data ?? {}) as Record<string, unknown>;
  revalidatePath('/');
  revalidatePath('/membership');
  return {
    orderId: order.order_id,
    invoiceId: order.service_invoice_id,
    alreadyProcessed: result.alreadyProcessed === true,
  };
}

export async function confirmPaymentOrder(input: {
  paymentKey?: string;
  orderId?: string;
  amount?: number;
}): Promise<PaymentConfirmation> {
  if (!input.paymentKey || !input.orderId || !Number.isFinite(input.amount)) {
    throw new Error('결제 정보가 올바르지 않아요.');
  }

  const order = await getOwnedOrder(input.orderId);
  if (order.order_type !== 'service_invoice' || !order.service_invoice_id) throw new Error('레거시 크레딧 결제는 더 이상 처리하지 않아요.');
  if (order.amount !== input.amount) throw new Error('주문 금액과 결제 금액이 일치하지 않아요.');
  if (order.status === 'paid') {
    if (order.provider_payment_key && order.provider_payment_key !== input.paymentKey) {
      throw new Error('이미 다른 결제 키로 처리된 주문이에요.');
    }
    return {
      orderId: order.order_id,
      invoiceId: order.service_invoice_id,
      alreadyProcessed: true,
    };
  }

  const sb = getServiceClient();
  const { data: transitioned, error: transitionError } = await sb
    .from('payment_orders')
    .update({
      status: 'confirming',
      provider_payment_key: input.paymentKey,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .in('status', ['ready', 'failed', 'reconcile_required'])
    .select('id, status, provider_payment_key')
    .maybeSingle();

  if (transitionError) {
    throw new Error(`결제 주문 상태를 변경하지 못했어요: ${transitionError.message}`);
  }
  if (!transitioned) {
    const { data: latest, error: latestError } = await sb
      .from('payment_orders')
      .select('status, provider_payment_key')
      .eq('id', order.id)
      .maybeSingle();
    if (latestError) throw new Error('결제 주문 상태를 다시 확인하지 못했어요.');
    if (latest?.status === 'paid' && latest.provider_payment_key === input.paymentKey) {
      return {
        orderId: order.order_id,
        invoiceId: order.service_invoice_id,
        alreadyProcessed: true,
      };
    }
    throw new Error('다른 요청이 이 결제를 처리하고 있어요. 잠시 후 결제 내역을 다시 확인해 주세요.');
  }

  let payment: TossPayment;
  try {
    payment = await confirmTossPayment({
      paymentKey: input.paymentKey,
      orderId: order.order_id,
      amount: order.amount,
      idempotencyKey: order.idempotency_key,
    });
  } catch (error) {
    // A browser retry can arrive after Toss has already approved the payment.
    // Re-read the provider before classifying it as failed.
    try {
      payment = await getTossPayment(input.paymentKey);
    } catch {
      const code = error instanceof TossApiError ? error.code : 'CONFIRM_FAILED';
      const message = error instanceof Error ? error.message : '결제 승인에 실패했어요.';
      await sb.rpc('record_payment_reconciliation', {
        p_order_id: order.order_id,
        p_status: 'FAILED',
        p_provider_payload: error instanceof TossApiError ? error.payload : {},
        p_failure_code: code,
        p_failure_message: message,
      });
      throw error;
    }
  }

  assertTossPaymentMatches(payment, {
    paymentKey: input.paymentKey,
    orderId: order.order_id,
    amount: order.amount,
  });
  return finalize(order, payment);
}

export async function reconcilePaymentFromProvider(payment: TossPayment): Promise<void> {
  if (!payment.orderId || !payment.paymentKey) throw new Error('결제 식별자가 누락됐어요.');
  const sb = getServiceClient();
  const { data: order, error } = await sb
    .from('payment_orders')
    .select('*')
    .eq('order_id', payment.orderId)
    .maybeSingle();
  if (error || !order) throw new Error('결제 주문을 찾을 수 없어요.');

  const typedOrder = order as PaymentOrderRow;
  assertTossPaymentMatches(payment, {
    paymentKey: payment.paymentKey,
    orderId: typedOrder.order_id,
    amount: typedOrder.amount,
  });

  if (payment.status === 'DONE') {
    await finalize(typedOrder, payment);
    return;
  }

  const { error: reconcileError } = await sb.rpc('record_payment_reconciliation', {
    p_order_id: typedOrder.order_id,
    p_status: payment.status,
    p_provider_payload: payment,
    p_failure_code: null,
    p_failure_message: null,
  });
  if (reconcileError) throw new Error(reconcileError.message);
}

export async function markPaymentFailure(input: {
  orderId?: string;
  code?: string;
  message?: string;
}): Promise<void> {
  if (!input.orderId) return;
  try {
    const order = await getOwnedOrder(input.orderId);
    if (order.status === 'paid') return;
    const sb = getServiceClient();
    await sb.rpc('record_payment_reconciliation', {
      p_order_id: order.order_id,
      p_status: 'FAILED',
      p_provider_payload: {},
      p_failure_code: (input.code ?? 'CLIENT_PAYMENT_FAILED').slice(0, 100),
      p_failure_message: (input.message ?? '결제가 완료되지 않았어요.').slice(0, 500),
    });
  } catch {
    // The failure page must remain usable even when the local order cannot be found.
  }
}

export type PaymentReconciliationCandidate = {
  orderId: string;
  paymentKey: string;
  localStatus: string;
};

export async function listPaymentReconciliationCandidates(
  limit = 25,
): Promise<PaymentReconciliationCandidate[]> {
  const sb = getServiceClient();
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const { data, error } = await sb
    .from('payment_orders')
    .select('order_id, provider_payment_key, status')
    .in('status', ['confirming', 'reconcile_required'])
    .not('provider_payment_key', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(safeLimit);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<{
    order_id: string;
    provider_payment_key: string | null;
    status: string;
  }>)
    .filter((row): row is { order_id: string; provider_payment_key: string; status: string } => Boolean(row.provider_payment_key))
    .map((row) => ({
      orderId: row.order_id,
      paymentKey: row.provider_payment_key,
      localStatus: row.status,
    }));
}

export async function reconcilePendingPayments(limit = 25): Promise<{
  scanned: number;
  reconciled: number;
  failed: number;
}> {
  const candidates = await listPaymentReconciliationCandidates(limit);
  let reconciled = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const payment = await getTossPayment(candidate.paymentKey);
      await reconcilePaymentFromProvider(payment);
      reconciled += 1;
    } catch (error) {
      failed += 1;
      console.error('[payment reconciliation]', candidate.orderId, error);
    }
  }

  return { scanned: candidates.length, reconciled, failed };
}
