'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { amountFor, summarizeWork } from '@/lib/db/gig-payouts';
import { isGigStaff } from '@/lib/facility-mode';
import { withholding } from '@/lib/withholding';
import { nudgeNotificationDispatch } from '@/lib/notify-nudge';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
function todayKST() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function nextDay(date: string) { return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10); }

// 지급은 사업장 종류와 무관하게 '긱 근무자'에게만 기록한다. 직원 월급은 /payroll 이 맡는다.
async function requireFacility(sb: NonNullable<ReturnType<typeof adminClient>>, facilityId: string) {
  const { data: facility, error } = await sb.from('facilities').select('name').eq('id', facilityId).is('deleted_at', null).maybeSingle();
  if (error || !facility) throw new Error('근무지를 찾을 수 없어요.');
  return facility;
}

async function notifyWorker(sb: NonNullable<ReturnType<typeof adminClient>>, staffId: string, facilityName: string, kind: 'payout.paid' | 'payout.scheduled', amount: number, payAt: string | null, payoutId: string) {
  const { data: staff } = await sb.from('facility_staff').select('worker_id,workers(auth_user_id)').eq('id', staffId).maybeSingle();
  const authUserId = (Array.isArray(staff?.workers) ? staff?.workers[0] : staff?.workers)?.auth_user_id as string | undefined;
  if (!authUserId) return;
  await sb.from('notification_outbox').insert({
    worker_auth_user_id: authUserId, event_type: kind, dedupe_key: `${kind}:${payoutId}`,
    title: kind === 'payout.paid' ? `${facilityName} 급여 지급 완료` : `${facilityName} 급여 지급 예정`,
    body: kind === 'payout.paid' ? `${amount.toLocaleString('ko-KR')}원이 지급 처리됐어요. 입금을 확인해 주세요.` : `${amount.toLocaleString('ko-KR')}원이 ${payAt ?? '추후'} 지급 예정으로 잡혔어요.`,
    data: { url: '/gig/settlement', kind, staff_id: staffId, payout_id: payoutId },
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
  const today = todayKST();
  if (mode === 'later' && (payAt ?? '') < today) throw new Error('지급 예정일은 오늘 이후로 선택해 주세요.');

  const [{ data: staff }, facility, { data: last }, { data: bankShare }] = await Promise.all([
    sb.from('facility_staff').select('id,name,worker_id,worker_kind,pay_basis,pay_rate,contract_start').eq('id', staffId).eq('facility_id', context.facilityId).maybeSingle(),
    requireFacility(sb, context.facilityId),
    sb.from('gig_payouts').select('period_end').eq('facility_id', context.facilityId).eq('staff_id', staffId)
      .neq('status', 'cancelled').order('period_end', { ascending: false }).limit(1).maybeSingle(),
    sb.from('gig_bank_account_shares').select('bank_account_id').eq('facility_id', context.facilityId).eq('staff_id', staffId).maybeSingle(),
  ]);
  if (!staff) throw new Error('근무자를 찾을 수 없어요.');
  if (!isGigStaff(staff)) throw new Error('직원 급여는 급여 관리(/payroll)에서 처리해 주세요. 지급 관리는 단기·긱 근무자 전용이에요.');
  if (!bankShare?.bank_account_id || !staff.worker_id) throw new Error('근무자가 지급 계좌를 전달한 뒤 지급할 수 있어요.');
  const { data: activeBank } = await sb.from('worker_bank_accounts').select('id').eq('id', bankShare.bank_account_id)
    .eq('worker_id', staff.worker_id).eq('is_primary', true).is('deleted_at', null).maybeSingle();
  if (!activeBank) throw new Error('근무자가 변경한 지급 계좌를 다시 전달해야 해요.');
  if (!staff.pay_basis || !staff.pay_rate) throw new Error('먼저 급여 기준(시급·일급)을 설정해 주세요.');
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
  if (error?.code === '23505') throw new Error('같은 기간의 지급 기록이 이미 있어요. 화면을 새로고침해 주세요.');
  if (error || !created) throw new Error('지급 기록을 저장하지 못했어요.');
  await notifyWorker(sb, staffId, facility?.name ?? '근무지', mode === 'now' ? 'payout.paid' : 'payout.scheduled', tax.net, mode === 'now' ? today : payAt, created.id);
  revalidatePath('/gig-pay'); revalidatePath('/');
}

// 예정이던 지급을 완료로 바꾼다
export async function markGigPayoutPaidAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const facility = await requireFacility(sb, context.facilityId);
  const payoutId = text(form, 'payout_id');
  const { data: payout, error } = await sb.from('gig_payouts')
    .update({ status: 'paid', paid_at: new Date().toISOString(), pay_at: todayKST(), updated_at: new Date().toISOString() })
    .eq('id', payoutId).eq('facility_id', context.facilityId).eq('status', 'scheduled')
    .select('id,staff_id,amount,net_amount').maybeSingle();
  if (error) throw new Error('지급 완료 처리를 하지 못했어요.');
  if (!payout) throw new Error('이미 처리됐거나 지급 예정 상태가 아니에요. 화면을 새로고침해 주세요.');
  await notifyWorker(sb, payout.staff_id, facility?.name ?? '근무지', 'payout.paid', Number(payout.net_amount ?? payout.amount), todayKST(), `${payoutId}:paid`);
  revalidatePath('/gig-pay'); revalidatePath('/');
}

export async function cancelGigPayoutAction(form: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  await requireFacility(sb, context.facilityId);
  const payoutId = text(form, 'payout_id');
  const { data, error } = await sb.from('gig_payouts').update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', payoutId).eq('facility_id', context.facilityId).eq('status', 'scheduled').select('id').maybeSingle();
  if (error) throw new Error('지급 예정을 취소하지 못했어요.');
  if (!data) throw new Error('이미 처리됐거나 지급 예정 상태가 아니에요. 화면을 새로고침해 주세요.');
  revalidatePath('/gig-pay'); revalidatePath('/');
}
