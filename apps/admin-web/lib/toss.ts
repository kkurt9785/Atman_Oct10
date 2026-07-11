
const TOSS_API_BASE = 'https://api.tosspayments.com/v1';

export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  method?: string | null;
  requestedAt?: string;
  approvedAt?: string | null;
  cancels?: Array<Record<string, unknown>> | null;
  [key: string]: unknown;
};

export class TossApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = 'TossApiError';
  }
}

function secretKey(): string {
  const key = process.env.TOSS_SECRET_KEY;
  if (!key) throw new Error('TOSS_SECRET_KEY가 설정되지 않았어요.');
  return key;
}

function headers(idempotencyKey?: string): HeadersInit {
  return {
    Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString('base64')}`,
    'Content-Type': 'application/json',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

async function parseResponse(response: Response): Promise<TossPayment> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new TossApiError(
      typeof payload?.message === 'string' ? payload.message : '토스페이먼츠 요청에 실패했어요.',
      typeof payload?.code === 'string' ? payload.code : 'TOSS_API_ERROR',
      response.status,
      payload,
    );
  }
  return payload as TossPayment;
}

export async function confirmTossPayment(input: {
  paymentKey: string;
  orderId: string;
  amount: number;
  idempotencyKey: string;
}): Promise<TossPayment> {
  const response = await fetch(`${TOSS_API_BASE}/payments/confirm`, {
    method: 'POST',
    headers: headers(input.idempotencyKey),
    body: JSON.stringify({
      paymentKey: input.paymentKey,
      orderId: input.orderId,
      amount: input.amount,
    }),
    cache: 'no-store',
  });
  return parseResponse(response);
}

export async function getTossPayment(paymentKey: string): Promise<TossPayment> {
  const response = await fetch(`${TOSS_API_BASE}/payments/${encodeURIComponent(paymentKey)}`, {
    method: 'GET',
    headers: headers(),
    cache: 'no-store',
  });
  return parseResponse(response);
}

export function assertTossPaymentMatches(
  payment: TossPayment,
  expected: { paymentKey: string; orderId: string; amount: number },
): void {
  if (payment.paymentKey !== expected.paymentKey) throw new Error('결제 키가 주문과 일치하지 않아요.');
  if (payment.orderId !== expected.orderId) throw new Error('주문번호가 결제와 일치하지 않아요.');
  if (payment.totalAmount !== expected.amount) throw new Error('결제 금액이 주문과 일치하지 않아요.');
}
