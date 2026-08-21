import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui';
import { getAdminContext } from '@/lib/admin-auth';
import { isLiveDemoFacility, isLiveDemoShift } from '@/lib/live-demo';
import { adminClient } from '@/lib/supabase';
import {
  acceptLiveDemoApplicationAction,
  markLiveDemoPaymentPaidAction,
  prepareLiveDemoAction,
  recordLiveDemoAttendanceAction,
} from './actions';
import { LiveDemoLocationButton } from './LiveDemoLocationButton';

const NOTICE: Record<string, string> = {
  ready: '시연 공고를 오늘 일정으로 준비했어요. 워커 앱에서 공고를 열어 지원해 보세요.',
  accepted: '지원자를 수락했어요. 워커 알림과 채팅을 확인해 보세요.',
  checked_in: '관리자 수동 출근으로 기록했어요.',
  checked_out: '관리자 수동 퇴근을 기록하고 지급 요청을 만들었어요.',
  paid: '시연용 지급 완료 처리가 끝났어요. 워커 앱에서 입금 완료를 확인해 보세요.',
};
const ROLE: Record<string, string> = { rn: '간호사', na: '간호조무사', pharmacist: '약사', pharmacy_staff: '전산·사무직' };
const PAYMENT: Record<string, string> = { draft: '지급 검토 전', approved: '지급 승인', exported: '이체 준비', paid: '지급 완료', worker_confirmed: '입금 확인' };

type Shift = { id: string; shift_date: string; start_time: string; end_time: string; required_role: string; department: string | null; notes: string | null; status: string };
type Application = { id: string; shift_id: string; worker_id: string; status: string; workers: { name: string; role: string } | { name: string; role: string }[] | null };
type Attendance = { application_id: string; check_in_at: string | null; check_out_at: string | null };
type Payment = { id: string; attendance_id: string; status: string; gross_amount: number; net_amount: number };

function one<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }

export default async function LiveDemoPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const context = await getAdminContext();
  const sb = adminClient();
  if (!context || !sb || context.accessRole === 'sales') notFound();
  const { data: facility } = await sb.from('facilities')
    .select('name,is_demo,business_registration_number,facility_type')
    .eq('id', context.facilityId).maybeSingle();
  if (!isLiveDemoFacility(facility)) notFound();

  const { data: rawShifts } = await sb.from('shifts')
    .select('id,shift_date,start_time,end_time,required_role,department,notes,status')
    .eq('facility_id', context.facilityId)
    .like('notes', 'LIVE-SALES-DEMO-%')
    .order('created_at', { ascending: false });
  const shifts = ((rawShifts ?? []) as Shift[]).filter((shift) => isLiveDemoShift(shift.notes));
  const shiftIds = shifts.map((shift) => shift.id);
  const { data: rawApplications } = shiftIds.length
    ? await sb.from('shift_applications').select('id,shift_id,worker_id,status,workers(name,role)').in('shift_id', shiftIds).order('applied_at', { ascending: false })
    : { data: [] as Application[] };
  const applications = (rawApplications ?? []) as Application[];
  const applicationIds = applications.map((application) => application.id);
  const { data: rawAttendances } = applicationIds.length
    ? await sb.from('shift_attendances').select('id,application_id,check_in_at,check_out_at').in('application_id', applicationIds)
    : { data: [] as Array<Attendance & { id: string }> };
  const attendances = (rawAttendances ?? []) as Array<Attendance & { id: string }>;
  const attendanceByApplication = new Map(attendances.map((attendance) => [attendance.application_id, attendance]));
  const attendanceIds = attendances.map((attendance) => attendance.id);
  const { data: rawPayments } = attendanceIds.length
    ? await sb.from('wage_payment_instructions').select('id,attendance_id,status,gross_amount,net_amount').in('attendance_id', attendanceIds)
    : { data: [] as Payment[] };
  const paymentByAttendance = new Map(((rawPayments ?? []) as Payment[]).map((payment) => [payment.attendance_id, payment]));
  const notice = NOTICE[(await searchParams).notice ?? ''];

  return <main className="mx-auto max-w-2xl px-4 pb-20 pt-4">
    <div className="mb-5 flex items-center justify-between gap-3">
      <div><p className="text-[12px] font-bold text-violet-700">숨은 현장 시연 도구 · 실제 구독 사업장에서는 사용할 수 없음</p><h1 className="mt-1 text-display font-extrabold text-ink">{facility?.name} 즉시 시연</h1></div>
      <Link href="/" className="shrink-0 text-[13px] font-bold text-sub">홈으로</Link>
    </div>
    {notice && <p role="status" className="mb-4 rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-[13px] font-bold text-success">{notice}</p>}

    <Card className="border border-violet-200 bg-violet-50">
      <p className="text-body font-extrabold text-ink">두 기기에서, 한 번에 끝까지</p>
      <p className="mt-1 text-[12px] leading-5 text-sub">관리자는 아래 두 단계만 누르세요. 연결된 데모 워커는 새 공고를 바로 열어 지원하고, 이후 수락·채팅·출퇴근·지급을 같은 화면에서 이어갑니다.</p>
      <LiveDemoLocationButton />
      <form action={prepareLiveDemoAction} className="mt-2"><button className="min-h-11 w-full rounded-xl bg-violet-600 px-4 text-[13px] font-extrabold text-white">2. 연결된 워커에게 시연 공고 보내기</button></form>
      <p className="mt-2 text-[11px] leading-5 text-sub">1번은 이 데모 시설 좌표와 연결된 워커의 공고 탐색 지역만 현재 위치로 맞춥니다. 2번은 워커가 해당 공고를 바로 여는 알림을 보냅니다. GPS 100m · QR 보완으로 준비되며, 일반 운영 데이터와 실제 구독 사업장 설정은 건드리지 않아요.</p>
    </Card>

    <section className="mt-6"><div className="mb-3 flex items-end justify-between px-1"><div><p className="text-[12px] font-bold text-primary">관리자 화면 순서</p><h2 className="text-title font-extrabold text-ink">지원부터 지급 완료까지</h2></div><Link href="/live-demo" className="text-[12px] font-bold text-primary">새로고침</Link></div>
      {shifts.length === 0 ? <Card className="py-9 text-center"><p className="font-bold">먼저 시연 공고를 준비해 주세요.</p><p className="mt-1 text-[12px] text-sub">위 버튼을 누르면 이 시설과 연결된 데모 워커에게 오늘 공고가 열립니다.</p></Card> : <div className="space-y-3">{shifts.map((shift) => {
        const application = applications.find((item) => item.shift_id === shift.id) ?? null;
        const worker = one(application?.workers);
        const attendance = application ? attendanceByApplication.get(application.id) ?? null : null;
        const payment = attendance ? paymentByAttendance.get((attendance as any).id) ?? null : null;
        const readyForCheckIn = application?.status === 'accepted' && !attendance?.check_in_at;
        const readyForCheckOut = application?.status === 'accepted' && Boolean(attendance?.check_in_at) && !attendance?.check_out_at;
        return <Card key={shift.id} className="overflow-hidden p-0"><div className="border-b border-line bg-white px-4 py-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-bold text-primary">{shift.shift_date} · {shift.start_time.slice(0,5)}~{shift.end_time.slice(0,5)}</p><p className="mt-1 text-body font-extrabold text-ink">{shift.department ?? '현장 근무'} · {ROLE[shift.required_role] ?? shift.required_role}</p></div><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700">현장 시연</span></div></div>
          {!application ? <div className="px-4 py-4"><p className="text-[13px] font-bold text-ink">1. 워커 앱에서 이 공고에 지원해 주세요</p><p className="mt-1 text-[12px] leading-5 text-sub">지원 후 이 화면을 새로고침하면 지원자와 수락 버튼이 바로 나타납니다.</p></div> : <div className="space-y-3 px-4 py-4"><div className="flex items-center justify-between"><div><p className="text-[13px] font-extrabold text-ink">{worker?.name ?? '데모 워커'} <span className="ml-1 text-[11px] text-sub">{ROLE[worker?.role ?? ''] ?? ''}</span></p><p className="mt-1 text-[12px] text-sub">{application.status === 'applied' ? '지원 확인 중' : application.status === 'accepted' ? '근무 확정' : application.status === 'completed' ? '근무 완료' : application.status}</p></div>{application.status === 'applied' && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">새 지원</span>}</div>
            {application.status === 'applied' && <form action={acceptLiveDemoApplicationAction}><input type="hidden" name="application_id" value={application.id}/><button className="min-h-11 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white">2. 바로 수락하고 워커에게 알림 보내기</button></form>}
            {application.status === 'accepted' && <><Link href={`/chats/${application.id}`} className="flex min-h-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/5 text-[13px] font-extrabold text-primary">3. 워커와 채팅 열기</Link>{readyForCheckIn && <form action={recordLiveDemoAttendanceAction}><input type="hidden" name="application_id" value={application.id}/><input type="hidden" name="event" value="check_in"/><button className="min-h-11 w-full rounded-xl bg-ink text-[13px] font-extrabold text-white">4. 관리자 수동 출근 처리</button></form>}{readyForCheckOut && <form action={recordLiveDemoAttendanceAction}><input type="hidden" name="application_id" value={application.id}/><input type="hidden" name="event" value="check_out"/><button className="min-h-11 w-full rounded-xl bg-ink text-[13px] font-extrabold text-white">5. 관리자 수동 퇴근 처리</button></form>}</>}
            {attendance?.check_out_at && <div className="rounded-xl bg-success/10 p-3"><p className="text-[12px] font-bold text-success">근무 종료 · 지급 요청이 생성됐어요</p>{payment ? <><div className="mt-2 flex items-center justify-between text-[12px]"><span className="text-sub">지급 상태</span><b className="text-ink">{PAYMENT[payment.status] ?? payment.status}</b></div><div className="mt-1 flex items-center justify-between text-[12px]"><span className="text-sub">시연 지급액</span><b className="text-primary">₩{payment.net_amount.toLocaleString('ko-KR')}</b></div>{['draft','approved','exported'].includes(payment.status) && context.canViewPayroll && ['owner','super'].includes(context.accessRole) && <form action={markLiveDemoPaymentPaidAction} className="mt-3"><input type="hidden" name="instruction_id" value={payment.id}/><button className="min-h-11 w-full rounded-xl bg-success text-[13px] font-extrabold text-white">6. 시연용 지급 완료 표시</button></form>}{['paid','worker_confirmed'].includes(payment.status) && <p className="mt-2 text-[12px] font-bold text-success">워커 앱에서 입금 완료·확인 화면을 열 수 있어요.</p>}</> : <p className="mt-2 text-[12px] text-warn">워커 지급계좌가 없어서 지급 요청이 생성되지 않았어요.</p>}</div>}
          </div>}</Card>;
      })}</div>}
    </section>
    <p className="mt-6 px-1 text-[12px] leading-5 text-sub">시연용 지급 완료는 실제 이체를 실행하지 않고 데모 지급 상태와 워커 알림만 바꿉니다. 일반 구독 사업장은 기존의 금액 검토 → 지급 승인 → 이체 준비 → 지급 완료 절차를 그대로 사용합니다.</p>
  </main>;
}
