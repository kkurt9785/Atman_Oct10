import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { todayKST } from '@/lib/date';

export async function POST() {
  try {
    const context = await requireAdminContext(['owner', 'super']);
    const sb = adminClient();
    if (!sb) throw new Error('Supabase 서버 설정을 확인해 주세요.');
    const { data: subscription, error: subscriptionError } = await sb
      .from('facility_subscriptions')
      .select('plan_code,service_plans(code,name,job_posting_addon_price)')
      .eq('facility_id', context.facilityId).in('status', ['active', 'past_due', 'pending'])
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (subscriptionError) throw new Error('현재 요금제를 확인하지 못했어요.');
    const plan = Array.isArray((subscription as any)?.service_plans)
      ? (subscription as any).service_plans[0] : (subscription as any)?.service_plans;
    if (!plan || plan.code === 'free') throw new Error('추가 공고는 유료 요금제에서 구매할 수 있어요.');
    const subtotal = Number(plan.job_posting_addon_price ?? 0);
    if (subtotal <= 0) throw new Error('추가 공고 가격이 설정되지 않았어요.');
    const taxAmount = Math.round(subtotal * 0.1);
    const totalAmount = subtotal + taxAmount;
    const now = new Date();
    const today = todayKST();
    const [year, month] = today.split('-').map(Number);
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const invoiceNumber = `ADD-${today.replaceAll('-', '')}-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const { data: invoice, error: invoiceError } = await sb.from('service_invoices').insert({
      facility_id: context.facilityId, subscription_id: null, invoice_number: invoiceNumber,
      period_start: periodStart, period_end: periodEnd, subtotal,
      tax_amount: taxAmount, total_amount: totalAmount, status: 'issued',
      due_date: today, issued_at: now.toISOString(),
    }).select('id,total_amount').single();
    if (invoiceError || !invoice) throw new Error('추가 공고 청구서를 만들지 못했어요.');
    const { error: itemError } = await sb.from('service_invoice_items').insert({
      invoice_id: invoice.id, item_type: 'job_posting_slot',
      description: '추가 공고 1건 (VAT 포함 9,900원 · 당월 사용)',
      quantity: 1, unit_amount: subtotal, amount: subtotal,
      metadata: { addon: true, vat_included_total: totalAmount, valid_month: periodStart.slice(0, 7) },
    });
    if (itemError) {
      await sb.from('service_invoices').delete().eq('id', invoice.id).eq('status', 'issued');
      throw new Error('추가 공고 청구 항목을 만들지 못했어요.');
    }
    return NextResponse.json({ invoiceId: invoice.id, amount: invoice.total_amount }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '추가 공고 구매를 준비하지 못했어요.';
    return NextResponse.json({ error: message }, { status: /로그인|권한|계정/.test(message) ? 401 : 400 });
  }
}
