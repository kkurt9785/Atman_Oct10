'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { TouchToCheckButton, type AttendanceMode, type AttendanceResult } from '@/components/attendance/AttendanceActionButton';
import { Wordmark } from '@/components/brand/BrandMark';
import { getLinkKinds, hasMedicalContext, isGigLink, loadWorkerShellContext, rememberWorkerShell } from '@/lib/worker-mode';
import { classifyNotice, noticeBelongsTo, type Notice } from '@/lib/notification-scope';
import { KakaoGlyph, startKakaoLogin } from '@/lib/kakao-login';
import { InstallAppButton } from '@/components/InstallAppButton';
import { WorkerModeBadge } from '@/components/worker/WorkerModeBadge';

const DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';

// 로그인 전 /gig = 잇닿 워커 안의 긱워커 간편모드 랜딩.
function GigLanding({ attendanceToken }: { attendanceToken: string | null }) {
  const router = useRouter();
  const [inviteLink, setInviteLink] = useState('');
  const [inviteError, setInviteError] = useState('');

  function login() {
    const query = new URLSearchParams();
    if (attendanceToken) query.set('attendanceToken', attendanceToken);
    window.localStorage.setItem('atman_auth_next', `/gig${query.size ? `?${query}` : ''}`);
    rememberWorkerShell('gig');
    startKakaoLogin();
  }
  function openInvite() {
    setInviteError('');
    const value = inviteLink.trim();
    let token: string | null = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : null;
    if (!token) { try { token = new URL(value).searchParams.get('token'); } catch { token = null; } }
    if (!token) { setInviteError('관리자가 보낸 초대 링크 전체를 붙여 넣어 주세요.'); return; }
    rememberWorkerShell('gig');
    router.push(`/gig/join?token=${encodeURIComponent(token)}`);
  }

  return <main className="min-h-screen bg-ink px-6 pb-10 pt-16 text-white">
    <div className="mx-auto flex min-h-[calc(100vh-104px)] max-w-md flex-col">
      <div className="flex items-center justify-between gap-3">
        <Wordmark size={20} tone="dark" />
        <WorkerModeBadge shell="gig" dark />
      </div>

      <h1 className="mt-14 text-[32px] font-extrabold leading-[1.2] tracking-[-1px]">근무부터 지급 확인까지<br />한 번에.</h1>
      <p className="mt-4 text-[15px] leading-6 text-white/70">초대받은 근무를 확인하고, 관리자와 대화하고,<br /><b className="text-white">출근하기</b> 버튼으로 출퇴근을 기록해요.</p>

      <ol className="mt-8 grid grid-cols-3 gap-2 text-center text-[12px] leading-4 text-white/80">
        <li className="rounded-2xl bg-white/8 px-2 py-4"><b className="mb-2 block text-[18px] text-white">1</b>잇기<br /><span className="text-white/55">초대 수락·계좌 전달</span></li>
        <li className="rounded-2xl bg-white/8 px-2 py-4"><b className="mb-2 block text-[18px] text-white">2</b>출근하기<br /><span className="text-white/55">출퇴근 기록·대화</span></li>
        <li className="rounded-2xl bg-white/8 px-2 py-4"><b className="mb-2 block text-[18px] text-white">3</b>지급 현황<br />확인</li>
      </ol>

      <div className="flex-grow" />

      <label className="block text-[12px] font-bold text-white/60">초대 링크가 있다면</label>
      <div className="mt-2 flex gap-2">
        <input value={inviteLink} onChange={(event) => setInviteLink(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && openInvite()} placeholder="초대 링크 붙여넣기" aria-label="초대 링크" className="h-12 min-w-0 flex-1 rounded-xl bg-white/10 px-3 text-[14px] text-white outline-none placeholder:text-white/40" />
        <button type="button" onClick={openInvite} className="h-12 shrink-0 rounded-xl bg-primary px-4 text-[14px] font-extrabold text-white">확인</button>
      </div>
      {inviteError && <p role="alert" className="mt-2 text-[12px] font-bold text-red-300">{inviteError}</p>}

      <button type="button" onClick={login} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-btn bg-kakao text-[16px] font-extrabold text-ink active:opacity-80">
        <KakaoGlyph />{attendanceToken ? '카카오로 로그인하고 출근 기록' : '이미 등록했어요 · 카카오로 로그인'}
      </button>
      {DEMO_ENABLED && <Link href="/gig/demo" className="mt-2 flex h-12 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-[14px] font-extrabold text-white">긱워커 데모로 먼저 보기 →</Link>}
      <div className="mt-2"><InstallAppButton label="잇닿 워커 앱으로 홈 화면에 추가" dark /></div>
      <p className="mt-4 text-center text-[11px] text-white/45"><Link href="/" className="font-bold text-white/70">병원·약국 워커로 시작</Link><span className="px-2">·</span>근무지 관리자이신가요? <a href="https://admin.itdot.co.kr" className="font-bold text-white/70">관리자 앱 →</a></p>
    </div>
  </main>;
}

type FacilityRef = { id: string; name: string };
type GigAssignment = {
  id: string; title: string; starts_on: string; ends_on: string; work_weekdays: number[];
  start_time: string; end_time: string; status: string; source?: string;
};
type Staff = {
  id: string; name: string; default_start_time: string; default_end_time: string; worker_kind?: string | null;
  contract_start?: string | null; contract_end?: string | null; work_weekdays?: number[] | null;
  facilities: FacilityRef | FacilityRef[];
  gig_assignments?: GigAssignment[] | null;
};
type AttendanceState = { staff_id: string; check_in_at: string | null; check_out_at: string | null; work_date: string; status?: string; break_minutes?: number };

const facilityOf = (staff: Staff) => (Array.isArray(staff.facilities) ? staff.facilities[0] : staff.facilities) ?? null;
function kstDate() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
// 관리자가 만든 근무 건(source='admin') 참여가 있으면 그것만 일정이다. 사람별 호환 건은 계약 범위 전체라 매일 '근무 예정'이 돼 버린다.
function scheduleAssignments(staff: Staff) {
  const all = staff.gig_assignments ?? [];
  return all.some((item) => item.source === 'admin') ? all.filter((item) => item.source === 'admin') : all;
}
function assignmentFor(staff: Staff,date=kstDate()) {
  const day=new Date(`${date}T00:00:00Z`).getUTCDay()||7;
  return scheduleAssignments(staff).find((item)=>['planned','active'].includes(item.status)&&item.starts_on<=date&&item.ends_on>=date&&(item.work_weekdays??[]).map(Number).includes(day))??null;
}
function isScheduledToday(staff: Staff) {
  const date = kstDate();
  if((staff.gig_assignments?.length??0)>0)return Boolean(assignmentFor(staff,date));
  if (staff.contract_start && date < staff.contract_start) return false;
  if (staff.contract_end && date > staff.contract_end) return false;
  const weekdays = staff.work_weekdays ?? [1, 2, 3, 4, 5];
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return weekdays.includes(day);
}
function timeLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
}

// 긱 홈은 오늘 근무와 출퇴근만 다룬다. 대화와 근태·지급은 각각 독립 탭으로 분리한다.
function GigTodayContent() {
  const params = useSearchParams();
  const attendanceToken = params.get('attendanceToken');
  const legacyToken = params.get('token');
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [attendance, setAttendance] = useState<Record<string, AttendanceState>>({});
  const [attendanceModes, setAttendanceModes] = useState<Record<string, AttendanceMode>>({});
  const [hasMedicalLink, setHasMedicalLink] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => { void (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSignedOut(true); setLoading(false); return; }
    // 긱 셸 알림함은 탭에 없다 — 헤더 종 아이콘이 유일한 입구라 안 읽은 긱 알림 수를 같이 보여 준다
    void Promise.all([supabase.rpc('get_my_notifications', { p_limit: 30 }), loadWorkerShellContext(user).catch(() => null)])
      .then(([{ data: notices }, context]) => {
        if (!context) return;
        setUnreadCount(((notices ?? []) as Notice[]).filter((row) => !row.read_at && noticeBelongsTo(classifyNotice(row, context), 'gig')).length);
      }).catch(() => undefined);
    const { data } = await supabase.from('facility_staff')
      .select('id,name,worker_kind,default_start_time,default_end_time,contract_start,contract_end,work_weekdays,facilities!facility_id(id,name),gig_assignments(id,title,starts_on,ends_on,work_weekdays,start_time,end_time,status,source)')
      .neq('status', 'ended').order('created_at', { ascending: false });
    const all = (data ?? []) as Staff[];
    const linked = all.filter(isGigLink);
    setStaffList(linked);
    setSelectedStaffId(linked[0]?.id ?? '');
    const { data: workerRow } = await supabase.from('workers').select('role').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle();
    setHasMedicalLink(hasMedicalContext(getLinkKinds(all), workerRow?.role));
    if (linked.length) {
      const facilityIds = [...new Set(linked.map((item) => facilityOf(item)?.id).filter(Boolean))] as string[];
      const [{ data: settings }, { data: records }] = await Promise.all([
        supabase.from('facility_attendance_settings').select('facility_id,authentication_mode').in('facility_id', facilityIds),
        supabase.from('staff_attendances').select('staff_id,check_in_at,check_out_at,work_date,status,break_minutes')
          .in('staff_id', linked.map((item) => item.id)).gte('work_date', new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString().slice(0, 10)).order('work_date', { ascending: false }),
      ]);
      setAttendanceModes(Object.fromEntries((settings ?? []).map((row) => [row.facility_id, row.authentication_mode as AttendanceMode])));
      const today = kstDate();
      const map: Record<string, AttendanceState> = {};
      const rows = (records ?? []) as AttendanceState[];
      for (const row of rows) if (!map[row.staff_id] && row.work_date === today) map[row.staff_id] = row;
      for (const row of rows) if (!map[row.staff_id] && row.check_in_at && !row.check_out_at) map[row.staff_id] = row;
      setAttendance(map);
    }
    if (legacyToken) setMessage('이전 정적 QR은 운영 종료됐어요. 관리자 화면의 동적 QR을 다시 스캔해 주세요.');
    setLoading(false);
  })(); }, [attendanceToken, legacyToken]);

  const staff = staffList.find((item) => item.id === selectedStaffId) ?? staffList[0] ?? null;
  const facility = staff ? facilityOf(staff) : null;
  const assignment=staff?assignmentFor(staff):null;
  const mode = facility?.id ? attendanceModes[facility.id] ?? 'gps_or_qr' : 'gps_or_qr';
  const current = staff ? attendance[staff.id] : null;
  const scheduledToday = Boolean(staff && isScheduledToday(staff));
  const canRecord = Boolean(current?.check_in_at) || scheduledToday;
  const done = Boolean(current?.check_out_at);
  const pending = current?.status === 'checkout_pending';

  if (signedOut) return <GigLanding attendanceToken={attendanceToken} />;

  return <main className="min-h-screen bg-bg px-4 pb-8 pt-5">
    <header className="flex items-start justify-between gap-3">
      <div><Wordmark size={20} /><div className="mt-2"><WorkerModeBadge shell="gig" /></div></div>
      <div className="flex items-center gap-2">
        {hasMedicalLink && <Link href="/home" onClick={() => rememberWorkerShell('medical')} className="rounded-full border border-line bg-white px-3 py-2 text-[11px] font-extrabold text-sub">병원·약국 모드</Link>}
        <Link href="/gig/notifications" aria-label={unreadCount ? `근무 알림 ${unreadCount}건 안 읽음` : '근무 알림'} className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-sub">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
          {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </Link>
        <Link href="/gig/settings" aria-label="앱 설정" className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-[16px] text-sub">⚙</Link>
      </div>
    </header>

    <section className="mt-5 rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <p className="text-[11px] font-extrabold text-primary-light">긱워커 · 초대받은 근무</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div><h1 className="text-[24px] font-extrabold">오늘 근무</h1><p className="mt-1 text-[13px] text-white/65">출퇴근 기록에만 집중하면 돼요.</p></div>
        {staff && <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/80">{staff.name}님</span>}
      </div>
    </section>

    {loading ? <div className="mt-3 rounded-2xl bg-white p-8 text-center text-sub">근무를 확인하고 있어요...</div>
      : !staff && hasMedicalLink ? <section className="mt-3 rounded-2xl bg-white p-8 text-center shadow-sm" aria-busy="true">
          <b className="text-[16px] text-ink">병원·약국 모드로 이동 중이에요</b>
          <p className="mt-2 text-[13px] leading-5 text-sub">긱 근무 초대를 받으면 이 화면에서 바로 연결돼요.</p>
        </section>
      : !staff ? <section className="mt-3 rounded-2xl bg-white p-8 text-center shadow-sm">
          <b className="text-[16px] text-ink">아직 연결된 근무가 없어요</b>
          <p className="mt-2 text-[13px] leading-5 text-sub">관리자가 보낸 초대 링크나 QR을 열어 '잇기'하면 근무·대화·지급이 한 번에 연결돼요.</p>
        </section>
      : <>
        {staffList.length > 1 && <label className="mt-3 block rounded-2xl bg-white p-4 text-[12px] font-bold text-sub shadow-sm">근무지 선택<select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-ink">{staffList.map((item) => <option key={item.id} value={item.id}>{facilityOf(item)?.name ?? '근무지'} · {item.name}</option>)}</select></label>}

        <section className="mt-3 rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[11px] font-extrabold tracking-[0.1em] text-primary">{scheduledToday || current?.check_in_at ? assignment?.title??'근무 예정' : '오늘 일정 없음'}</p><h2 className="mt-1 text-[20px] font-extrabold text-ink">{facility?.name ?? '근무지'}</h2><p className="mt-1 text-[13px] text-sub">{(assignment?.start_time??staff.default_start_time).slice(0, 5)} – {(assignment?.end_time??staff.default_end_time).slice(0, 5)}{assignment?.ends_on?` · ${assignment.ends_on}까지`:staff.contract_end?` · ${staff.contract_end}까지`:''}</p></div>
            <span className={`rounded-full px-3 py-1.5 text-[11px] font-extrabold ${done ? 'bg-emerald-50 text-emerald-600' : pending ? 'bg-amber-50 text-amber-700' : current?.check_in_at ? 'bg-primary/10 text-primary' : 'bg-bg text-sub'}`}>{done ? '근무 완료' : pending ? '승인 대기' : current?.check_in_at ? '근무 중' : '출근 전'}</span>
          </div>

          {(current?.check_in_at || current?.check_out_at) && <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-bg p-3 text-center"><div><p className="text-[10px] text-sub">출근</p><p className="mt-0.5 text-[15px] font-extrabold text-ink">{timeLabel(current.check_in_at)}</p></div><div><p className="text-[10px] text-sub">퇴근</p><p className="mt-0.5 text-[15px] font-extrabold text-ink">{timeLabel(current.check_out_at)}</p></div></div>}

          {done ? <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-center"><p className="text-[14px] font-extrabold text-emerald-700">오늘 근무를 완료했어요</p><Link href="/gig/settlement" className="mt-2 inline-flex text-[12px] font-extrabold text-primary">근태·지급 현황 확인 →</Link></div>
            : pending ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-center text-[13px] font-bold text-amber-700">조기 퇴근 승인 대기 중이에요. 관리자가 승인하면 근무시간이 확정돼요.</p>
            : canRecord ? <div className="mt-4">
                <TouchToCheckButton
                  key={current?.check_in_at ? 'check_out' : 'check_in'} dark targetType="staff" targetId={staff.id}
                  action={current?.check_in_at ? 'check_out' : 'check_in'} qrToken={attendanceToken} mode={mode}
                  onSuccess={(response: AttendanceResult) => {
                    const now = new Date().toISOString();
                    const checkingOut = Boolean(current?.check_in_at);
                    setAttendance((state) => ({ ...state, [staff.id]: {
                      ...(state[staff.id] ?? { staff_id: staff.id, work_date: kstDate(), check_in_at: null, check_out_at: null }),
                      ...(checkingOut
                        ? (response.status === 'pending' ? { status: 'checkout_pending' } : { check_out_at: response.checkOutAt ?? now, status: 'completed' })
                        : { check_in_at: response.checkInAt ?? now, status: 'working' }),
                    } }));
                  }}
                />
                <p className="mt-1 text-center text-[12px] leading-5 text-sub">근무지에서 1초간 누르면 기록돼요.<br />필요하면 관리자의 동적 QR로 인증해요.</p>
              </div>
            : <p className="mt-4 rounded-xl bg-bg p-3 text-center text-[13px] text-sub">오늘은 초대받은 근무일이 아니에요.</p>}
        </section>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href={`/gig/workroom${facility?.id ? `?facility=${encodeURIComponent(facility.id)}` : ''}`} className="rounded-2xl bg-white p-4 shadow-sm active:bg-bg"><span className="text-[18px]">💬</span><b className="mt-3 block text-[15px] text-ink">관리자와 대화</b><span className="mt-1 block text-[11px] leading-4 text-sub">공지·출석 확인·근무 대화</span></Link>
          <Link href="/gig/settlement" className="rounded-2xl bg-white p-4 shadow-sm active:bg-bg"><span className="text-[18px]">✓</span><b className="mt-3 block text-[15px] text-ink">근태·지급</b><span className="mt-1 block text-[11px] leading-4 text-sub">기록 확인·지급 계좌·지급 현황</span></Link>
        </div>
      </>}
    {message && <p role="status" className="mt-4 rounded-xl border border-line bg-white p-3 text-[13px] font-bold">{message}</p>}
  </main>;
}

export default function GigTodayPage() {
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">근무 정보를 불러오고 있어요...</main>}><GigTodayContent /></Suspense>;
}
