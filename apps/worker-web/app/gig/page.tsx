'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AttendanceActionButton, type AttendanceMode, type AttendanceResult } from '@/components/attendance/AttendanceActionButton';
import { MyAttendanceCalendar } from '@/components/attendance/MyAttendanceCalendar';
import { setGigworkerModePreference } from '@/lib/worker-mode';

// 긱워커 "오늘 근무" — 초대받은 근무지(registration_source=gigworker_trial)만 다룬다.
// 병원·약국 직원의 출퇴근·휴가는 /workplace 가 맡는다. 두 화면은 코드를 공유하지 않는다.

type FacilityRef = { id: string; name: string; registration_source?: string | null };
type Staff = {
  id: string; name: string; default_start_time: string; default_end_time: string;
  contract_start?: string | null; contract_end?: string | null; work_weekdays?: number[] | null;
  facilities: FacilityRef | FacilityRef[];
};
type AttendanceState = { staff_id: string; check_in_at: string | null; check_out_at: string | null; work_date: string; status?: string; break_minutes?: number };

const WEEKDAY_LABEL = ['월', '화', '수', '목', '금', '토', '일'];
const facilityOf = (staff: Staff) => (Array.isArray(staff.facilities) ? staff.facilities[0] : staff.facilities) ?? null;
function kstDate() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
// 계약 기간·요일 밖이면 출근 버튼을 숨긴다 — DB record_unified_attendance 의 NOT_SCHEDULED(긱워커 근무지 한정)와 같은 규칙
function isScheduledToday(staff: Staff) {
  const date = kstDate();
  if (staff.contract_start && date < staff.contract_start) return false;
  if (staff.contract_end && date > staff.contract_end) return false;
  const weekdays = staff.work_weekdays ?? [1, 2, 3, 4, 5];
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return weekdays.includes(day);
}
function weekdayText(days?: number[] | null) {
  const sorted = (days ?? [1, 2, 3, 4, 5]).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
  return sorted.map((day) => WEEKDAY_LABEL[day - 1]).join('·');
}

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
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { void (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const query = new URLSearchParams();
      if (attendanceToken) query.set('attendanceToken', attendanceToken);
      window.localStorage.setItem('atman_auth_next', `/gig${query.size ? `?${query}` : ''}`);
      window.location.href = '/';
      return;
    }
    setGigworkerModePreference(true);
    const { data } = await supabase.from('facility_staff')
      .select('id,name,default_start_time,default_end_time,contract_start,contract_end,work_weekdays,facilities(id,name,registration_source)')
      .neq('status', 'ended').order('created_at', { ascending: false });
    const all = (data ?? []) as Staff[];
    const linked = all.filter((item) => facilityOf(item)?.registration_source === 'gigworker_trial');
    setHasMedicalLink(all.some((item) => facilityOf(item)?.registration_source !== 'gigworker_trial'));
    setStaffList(linked);
    setSelectedStaffId(linked[0]?.id ?? '');
    if (linked.length) {
      const facilityIds = [...new Set(linked.map((item) => facilityOf(item)?.id).filter(Boolean))] as string[];
      const { data: settings } = await supabase.from('facility_attendance_settings').select('facility_id,authentication_mode').in('facility_id', facilityIds);
      setAttendanceModes(Object.fromEntries((settings ?? []).map((row) => [row.facility_id, row.authentication_mode as AttendanceMode])));
      const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const since = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const todayStr = kstNow.toISOString().slice(0, 10);
      const { data: records } = await supabase.from('staff_attendances')
        .select('staff_id,check_in_at,check_out_at,work_date,status,break_minutes')
        .in('staff_id', linked.map((item) => item.id)).gte('work_date', since).order('work_date', { ascending: false });
      // 오늘 기록 우선. 야간 근무는 어제 work_date 로 적재되므로 '출근했고 퇴근 전'인 어제 행도 오늘 상태로 본다.
      const map: Record<string, AttendanceState> = {};
      const rows = (records ?? []) as AttendanceState[];
      for (const row of rows) if (!map[row.staff_id] && row.work_date === todayStr) map[row.staff_id] = row;
      for (const row of rows) if (!map[row.staff_id] && row.check_in_at && !row.check_out_at) map[row.staff_id] = row;
      setAttendance(map);
    }
    if (legacyToken) setMessage('이전 정적 QR은 운영 종료됐어요. 관리자 화면의 동적 QR을 다시 스캔해 주세요.');
    setLoading(false);
  })(); }, [attendanceToken, legacyToken]);

  const staff = staffList.find((item) => item.id === selectedStaffId) ?? staffList[0] ?? null;
  const staffFacility = staff ? facilityOf(staff) : null;
  const mode = staffFacility?.id ? attendanceModes[staffFacility.id] ?? 'gps_or_qr' : 'gps_or_qr';
  const current = staff ? attendance[staff.id] : null;
  const canRecord = Boolean(current?.check_in_at) || Boolean(staff && isScheduledToday(staff));

  return <main className="min-h-screen bg-bg px-4 pb-8 pt-5">
    <section className="rounded-3xl bg-ink px-5 py-5 text-white shadow-btn">
      <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em]">GIG WORKER</span><span className="text-[15px] font-extrabold text-primary">잇닿 GIG</span></div>
      <h1 className="mt-5 text-[27px] font-extrabold">오늘 근무</h1>
      <p className="mt-1 text-[13px] leading-5 text-white/65">초대받은 일정과 출퇴근 기록만 간단하게 확인해요.</p>
    </section>

    <Link href="/gig/workroom" className="mt-3 flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-sm active:bg-bg"><span><b className="block text-[15px] text-ink">사업장 워크룸</b><span className="mt-1 block text-[12px] text-sub">공지와 근무 대화를 전화번호 없이 확인해요</span></span><span className="text-[20px] font-bold text-primary">→</span></Link>

    {loading ? <div className="mt-6 rounded-2xl bg-white p-8 text-center text-sub">근태를 확인하고 있어요...</div>
      : !staff ? <section className="mt-6 rounded-2xl bg-white p-8 text-center">
          <b>아직 연결된 근무 초대가 없어요</b>
          <p className="mt-2 text-[13px] leading-5 text-sub">관리자가 보낸 초대 링크를 이 기기에서 열면 근무 조건을 확인하고 연결할 수 있어요.</p>
          {hasMedicalLink && <Link href="/workplace" className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-bg px-4 text-[13px] font-bold text-ink">병원·약국 출퇴근으로 이동</Link>}
        </section>
      : <>
        <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[18px] font-extrabold">{staffFacility?.name ?? '근무지'}</p>
          <p className="mt-1 text-[13px] text-sub">{staff.name} · 근무 {staff.default_start_time.slice(0, 5)}~{staff.default_end_time.slice(0, 5)}</p>
          <div className="mt-3 rounded-xl bg-primary/5 px-3 py-3 text-[12px] text-sub">
            <p><b className="text-primary">근무 기간</b> · {staff.contract_start ?? '시작일 미정'} ~ {staff.contract_end ?? '종료일 미정'}</p>
            <p className="mt-1"><b className="text-primary">근무 요일</b> · {weekdayText(staff.work_weekdays)}</p>
          </div>
          {staffList.length > 1 && <label className="mt-4 block text-[12px] text-sub">근무지 선택<select value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-white px-3">{staffList.map((item) => <option key={item.id} value={item.id}>{facilityOf(item)?.name ?? '근무지'} · {item.name}</option>)}</select></label>}
          <div className="mt-4 rounded-xl bg-bg p-3">
            <p className="text-[12px] font-bold text-primary">{current?.check_in_at ? '현재 근무 중' : canRecord ? '출근 전' : '오늘은 근무 없음'}</p>
            <p className="mt-1 text-[13px] text-sub">근무지 반경 안에서 버튼을 누르면 GPS 위치를 확인해 출퇴근을 기록해요. 실내에서는 관리자의 동적 QR로 인증할 수 있어요.</p>
          </div>
          {!current?.check_out_at && current?.status !== 'checkout_pending' && canRecord && (
            <AttendanceActionButton
              key={current?.check_in_at ? 'check_out' : 'check_in'}
              targetType="staff" targetId={staff.id}
              action={current?.check_in_at ? 'check_out' : 'check_in'}
              qrToken={attendanceToken} mode={mode}
              onSuccess={(response: AttendanceResult) => {
                const now = new Date().toISOString();
                const checkingOut = Boolean(current?.check_in_at);
                setAttendance((state) => ({
                  ...state,
                  [staff.id]: {
                    ...(state[staff.id] ?? { staff_id: staff.id, work_date: kstDate(), check_in_at: null, check_out_at: null }),
                    ...(checkingOut
                      ? (response.status === 'pending' ? { status: 'checkout_pending' } : { check_out_at: response.checkOutAt ?? now, status: 'completed' })
                      : { check_in_at: response.checkInAt ?? now, status: 'working' }),
                  },
                }));
                setRefreshKey((key) => key + 1);
              }}
            />
          )}
          {current?.status === 'checkout_pending' && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] font-bold text-amber-700">조기 퇴근 승인 대기 중이에요. 관리자가 승인하면 근무시간이 확정됩니다.</p>}
          {current?.check_out_at && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-[13px] font-bold text-emerald-700">오늘 출퇴근이 완료됐어요.</p>}
          {attendanceToken && <p className="mt-2 text-center text-[11px] font-bold text-primary">동적 QR을 확인했어요. 위치 확인 후 근무지 정책에 맞게 인증합니다.</p>}
        </section>
        <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-[18px] font-extrabold">내 근태 내역</h2>
          <div className="mt-3"><MyAttendanceCalendar staffId={staff.id} refreshKey={refreshKey} /></div>
          <p className="mt-3 text-[11px] leading-5 text-sub">수정이 필요한 기록은 근무지 관리자에게 요청하세요.</p>
        </section>
      </>}
    {message && <p role="status" className="mt-4 rounded-xl border border-line bg-white p-3 text-[13px] font-bold">{message}</p>}
  </main>;
}

export default function GigTodayPage() {
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">근무 정보를 불러오고 있어요...</main>}><GigTodayContent /></Suspense>;
}
