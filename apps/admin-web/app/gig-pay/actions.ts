'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { amountFor, summarizeWork } from '@/lib/db/gig-payouts';
import { withholding } from '@/lib/withholding';
import { nudgeNotificationDispatch } from '@/lib/notify-nudge';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
function todayKST() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function nextDay(date: string) { return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10); }

async function notifyWorker(sb: NonNullable<ReturnType<typeof adminClient>>, staffId: string, facilityName: string, kind: 'payout.paid' | 'payout.scheduled', amount: number, payAt: string | null, payoutId: string) {
  const { data: staff } = await sb.from('facility_staff').select('worker_id,workers(auth_user_id)').eq('id', staffId).maybeSingle();
  const authUserId = (Array.isArray(staff?.workers) ? staff?.workers[0] : staff?.workers)?.auth_user_id as string | undefined;
  if (!authUserId) return;
  await sb.from('notification_outbox').insert({
    worker_auth_user_id: authUserId, event_type: kind, dedupe_key: `${kind}:${payoutId}`,
    title: kind === 'payout.paid' ? `${facilityName} 급여 지급 완료` : `${facilityName} 급여 지급 예정`,
    body: kind === 'payout.paid' ? `${amount.toLocaleString('ko-KR')}원이 지급 처리됐어요. 입금을 확인해 주세요.` : `${amount.toLocaleString('ko-KR')}원이 ${payAt ?? '추후'} 지급 예정으로 잡혔어요.`,
    data: { url: '/workplace', kind, staff_id: staffId, payout_id: payoutId },
  });
  await nudgeNotificationDispatch();
}

// 마지막 지급 이후 완료된 근무를 한 건으로 묶는다. mode=now 면 바로 지급 완료, later 면 pay_at 날짜에 지급 예정.
export async function createGigPayoutAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const staffId = text(form, 'staff_id');
  const mode = text(form, 'mode') === 'later' ? 'later' : 'now';
  const payAt = text(form, 'pay_at') || null;
  const note = text(form, 'note') || null;
  const withhold = text(form, 'withhold') === '1';
  if (mode === 'later' && (!payAt || !/^\d{4}-\d{2}-\d{2}$/.test(payAt))) throw new Error('지급 예정일을 골라 주세요.');

  const [{ data: staff }, { data: facility }, { data: last }] = await Promise.all([
    sb.from('facility_staff').select('id,name,pay_basis,pay_rate,contract_start').eq('id', staffId).eq('facility_id', context.facilityId).maybeSingle(),
    sb.from('facilities').select('name').eq('id', context.facilityId).maybeSingle(),
    sb.from('gig_payouts').select('period_end').eq('staff_id', staffId).neq('status', 'cancelled').order('period_end', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!staff) throw new Error('근무자를 찾을 수 없어요.');
  if (!staff.pay_basis || !staff.pay_rate) throw new Error('먼저 급여 기준(시급·일급)을 설정해 주세요.');
  const today = todayKST();
  const since = last?.period_end ? nextDay(last.period_end) : (staff.contract_start ?? '2020-01-01');
  if (since > today) throw new Error('아직 지급할 근무가 없어요.');
  const work = await summarizeWork(sb, context.facilityId, staffId, since, today);
  const amount = amountFor(staff.pay_basis, Number(staff.pay_rate), work.minutes, work.days);
  if (work.days === 0 || amount <= 0) throw new Error('마지막 지급 이후 완료된 근무가 없어요.');
  const tax = withholding(amount, withhold);

  const { data: created, error } = await sb.from('gig_payouts').insert({
    facility_id: context.facilityId, staff_id: staffId, period_start: since, period_end: today,
    worked_minutes: work.minutes, worked_days: work.days, pay_basis: staff.pay_basis, pay_rate: staff.pay_rate, amount,
    withholding_rate: tax.rate, withholding_amount: tax.total, net_amount: tax.net,
    status: mode === 'now' ? 'paid' : 'scheduled', pay_at: mode === 'now' ? today : payAt,
    paid_at: mode === 'now' ? new Date().toISOString() : null, note, created_by: context.user.id,
  }).select('id').single();
  if (error || !created) throw new Error('지급 기록을 저장하지 못했어요.');
  await notifyWorker(sb, staffId, facility?.name ?? '근무지', mode === 'now' ? 'payout.paid' : 'payout.scheduled', tax.net, mode === 'now' ? today : payAt, created.id);
  revalidatePath('/gig-pay'); revalidatePath('/');
}

// 예정이던 지급을 완료로 바꾼다
export async function markGigPayoutPaidAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const payoutId = text(form, 'payout_id');
  const { data: payout } = await sb.from('gig_payouts').select('id,staff_id,amount,net_amount,status').eq('id', payoutId).eq('facility_id', context.facilityId).maybeSingle();
  if (!payout || payout.status !== 'scheduled') throw new Error('지급 예정 상태의 기록만 완료로 바꿀 수 있어요.');
  const { error } = await sb.from('gig_payouts').update({ status: 'paid', paid_at: new Date().toISOString(), pay_at: todayKST(), updated_at: new Date().toISOString() }).eq('id', payoutId);
  if (error) throw new Error('지급 완료 처리를 하지 못했어요.');
  const { data: facility } = await sb.from('facilities').select('name').eq('id', context.facilityId).maybeSingle();
  await notifyWorker(sb, payout.staff_id, facility?.name ?? '근무지', 'payout.paid', Number(payout.net_amount ?? payout.amount), todayKST(), `${payoutId}:paid`);
  revalidatePath('/gig-pay'); revalidatePath('/');
}

export async function cancelGigPayoutAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const payoutId = text(form, 'payout_id');
  const { error } = await sb.from('gig_payouts').update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', payoutId).eq('facility_id', context.facilityId).eq('status', 'scheduled');
  if (error) throw new Error('지급 예정을 취소하지 못했어요.');
  revalidatePath('/gig-pay'); revalidatePath('/');
}
