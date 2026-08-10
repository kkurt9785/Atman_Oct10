'use client';

import { useTransition, useState } from 'react';
import { saveFacilityProfile, registerWorkplaceNetwork, clearWorkplaceNetworks, type FacilityProfile } from '@/lib/actions/facility';

function Toggle({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className="flex items-center justify-between py-4 border-b border-line cursor-pointer">
      <span className="text-[15px] text-ink">{label}</span>
      <div className="relative">
        <input
          type="checkbox"
          name={name}
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="sr-only"
        />
        <div
          className={`w-12 h-7 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-line'}`}
        >
          <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
        </div>
      </div>
    </label>
  );
}

export function FacilityProfileForm({ profile,facilityType }: { profile: FacilityProfile | null; facilityType:string }) {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [netPending, startNetTransition] = useTransition();
  const [allowedIps, setAllowedIps] = useState<string[]>(profile?.allowed_ips ?? []);
  const [netMessage, setNetMessage] = useState('');
  const [attendanceMode, setAttendanceMode] = useState(profile?.attendance_mode ?? 'gps_or_qr');

  function handleRegisterNetwork() {
    setNetMessage('');
    startNetTransition(async () => {
      try {
        const { ip, allowed_ips } = await registerWorkplaceNetwork();
        setAllowedIps(allowed_ips);
        setNetMessage(`현재 네트워크(${ip})를 등록했어요 ✓`);
      } catch (err) {
        setNetMessage(err instanceof Error ? err.message : '등록 실패');
      }
    });
  }

  function handleClearNetworks() {
    setNetMessage('');
    startNetTransition(async () => {
      try {
        await clearWorkplaceNetworks();
        setAllowedIps([]);
        setNetMessage('등록된 네트워크를 모두 해제했어요');
      } catch (err) {
        setNetMessage(err instanceof Error ? err.message : '해제 실패');
      }
    });
  }
  const isPharmacy=facilityType==='pharmacy';
  const facilityWord=isPharmacy?'약국':facilityType==='care_hospital'?'요양병원':'병원';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSaved(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveFacilityProfile(formData);
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : '저장 실패');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-24">
      <div className="pt-8 pb-4 px-1">
        <h1 className="text-[24px] font-extrabold text-ink">{facilityWord} 프로필</h1>
        <p className="text-[13px] text-sub mt-1">워커가 시프트 지원 전 {facilityWord} 정보를 확인해요</p>
      </div>

      {/* 기본 정보 */}
      <section className="bg-white rounded-2xl p-5 mb-4">
        <p className="text-[13px] font-bold text-sub mb-4">기본 정보</p>

        {!isPharmacy&&<><div className="mb-4">
          <label className="block text-[13px] text-sub mb-1.5">병상 수</label>
          <input
            type="number"
            name="bed_count"
            defaultValue={profile?.bed_count ?? ''}
            placeholder="예: 120"
            min={1}
            className="w-full border border-line rounded-xl px-4 py-3 text-[15px] outline-none focus:border-primary"
          />
        </div>

        <div className="mb-4">
          <label className="block text-[13px] text-sub mb-1.5">주 병동</label>
          <input
            type="text"
            name="main_department"
            defaultValue={profile?.main_department ?? ''}
            placeholder="예: 요양병동, 재활병동"
            className="w-full border border-line rounded-xl px-4 py-3 text-[15px] outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="block text-[13px] text-sub mb-1.5">EMR 시스템</label>
          <input
            type="text"
            name="emr_system"
            defaultValue={profile?.emr_system ?? ''}
            placeholder="예: 비트컴퓨터, 이지케어텍"
            className="w-full border border-line rounded-xl px-4 py-3 text-[15px] outline-none focus:border-primary"
          />
        </div></>}
        {isPharmacy&&<div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-[13px] text-sub">약국 유형<select name="pharmacy_type" defaultValue={profile?.pharmacy_type??''} className="mt-1.5 h-12 w-full rounded-xl border border-line bg-white px-3"><option value="">선택해 주세요</option><option value="문전약국">문전약국</option><option value="동네약국">동네약국</option><option value="병원약국">병원약국</option><option value="24시간·야간약국">24시간·야간약국</option></select></label>
          <label className="col-span-2 text-[13px] text-sub">약국 전산 프로그램<input name="pharmacy_system" defaultValue={profile?.pharmacy_system??''} placeholder="예: 유팜, PM2000" className="mt-1.5 h-12 w-full rounded-xl border border-line px-4"/></label>
          <label className="text-[13px] text-sub">일평균 처방전 건수<input name="average_daily_prescriptions" type="number" min="0" max="10000" defaultValue={profile?.average_daily_prescriptions??''} placeholder="예: 120건" className="mt-1.5 h-12 w-full rounded-xl border border-line px-3"/></label>
          <label className="text-[13px] text-sub">인수인계 시간<input name="handover_minutes" type="number" min="0" max="240" step="10" defaultValue={profile?.handover_minutes??''} placeholder="예: 20분" className="mt-1.5 h-12 w-full rounded-xl border border-line px-3"/></label>
          <p className="col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-[11px] leading-5 text-sub">최근 평일 기준 실제 일평균 건수를 입력해 주세요. 처방전 건수와 전산 프로그램은 대체약사가 업무 난이도를 판단하는 핵심 정보예요.</p>
        </div>}
      </section>

      {/* 편의시설 */}
      <section className="bg-white rounded-2xl px-5 mb-4">
        <p className="text-[13px] font-bold text-sub pt-5 pb-2">편의시설</p>
        <Toggle name="has_parking" label="🚗  주차 가능" defaultChecked={profile?.has_parking ?? false} />
        <Toggle name="has_meals"   label="🍱  식사 제공" defaultChecked={profile?.has_meals ?? false} />
        <Toggle name="has_uniform" label="👕  유니폼 제공" defaultChecked={profile?.has_uniform ?? false} />
        <div className="h-1" />
      </section>

      {/* 사업장 소개 */}
      <section className="bg-white rounded-2xl p-5 mb-6">
        <p className="text-[13px] font-bold text-sub mb-2">{facilityWord} 소개</p>
        <p className="text-[12px] text-tertiary mb-3">워커에게 보여질 한 두 줄 소개입니다</p>
        <textarea
          name="intro"
          defaultValue={profile?.intro ?? ''}
          rows={4}
          placeholder={isPharmacy?'예: 인수인계를 충분히 제공하고 반복근무를 우대합니다.':'예: 직원 간 분위기가 좋고 신규 간호사 적응을 적극 지원합니다.'}
          className="w-full border border-line rounded-xl px-4 py-3 text-[15px] outline-none focus:border-primary resize-none"
        />
      </section>

      <section id="attendance-auth" className="scroll-mt-20 bg-white rounded-2xl p-5 mb-6">
        <p className="text-[13px] font-bold text-sub mb-1">출퇴근 인증</p>
        <p className="text-[12px] text-tertiary mb-4">실내 GPS 오차를 고려해 {facilityWord} 환경에 맞게 선택하세요.</p>
        <label className="block text-[13px] text-sub mb-4">기본 인증 방식
          <select name="attendance_mode" value={attendanceMode} onChange={event=>setAttendanceMode(event.target.value as FacilityProfile['attendance_mode'])} className="mt-1.5 w-full h-12 rounded-xl border border-line bg-white px-3 text-[14px]">
            <option value="gps_or_qr">추천 · 앱에서 버튼만 누르기</option>
            <option value="gps">위치(GPS) 우선 · QR/Wi-Fi 보완</option>
            <option value="gps_qr">위치 + 동적 QR 모두 필수</option>
            <option value="qr">동적 QR만</option>
            <option value="network">사업장 Wi-Fi/IP만</option>
            <option value="admin">관리자 승인만</option>
          </select>
        </label>
        <div className="mb-4 rounded-xl bg-blue-50 p-3 text-[12px] leading-5 text-sub"><b className="text-primary">추천 · 버튼 한 번으로 출퇴근</b><br/>직원은 앱에서 출퇴근 버튼만 누르면 됩니다. 시스템이 위치 또는 등록된 {facilityWord} Wi-Fi를 자동으로 확인하고, 둘 다 어려울 때만 60초 동적 QR을 안내해요.</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] text-sub">GPS 반경
            <select name="gps_radius_meters" defaultValue={profile?.gps_radius_meters??30} className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-3">
              {[10,20,30,50,100].map(v=><option key={v} value={v}>{v}m</option>)}
            </select>
          </label>
          <label className="text-[12px] text-sub">허용 정확도
            <input name="max_gps_accuracy_meters" type="number" min="10" max="500" defaultValue={profile?.max_gps_accuracy_meters??80} className="mt-1 w-full h-11 rounded-xl border border-line px-3"/>
          </label>
          <label className="text-[12px] text-sub">출근 전(분)<input name="check_in_before_minutes" type="number" min="0" max="360" defaultValue={profile?.check_in_before_minutes??60} className="mt-1 w-full h-11 rounded-xl border border-line px-3"/></label>
          <label className="text-[12px] text-sub">출근 후(분)<input name="check_in_after_minutes" type="number" min="0" max="360" defaultValue={profile?.check_in_after_minutes??60} className="mt-1 w-full h-11 rounded-xl border border-line px-3"/></label>
          <label className="text-[12px] text-sub">퇴근 전(분)<input name="check_out_before_minutes" type="number" min="0" max="360" defaultValue={profile?.check_out_before_minutes??60} className="mt-1 w-full h-11 rounded-xl border border-line px-3"/></label>
          <label className="text-[12px] text-sub">퇴근 후(분)<input name="check_out_after_minutes" type="number" min="0" max="720" defaultValue={profile?.check_out_after_minutes??120} className="mt-1 w-full h-11 rounded-xl border border-line px-3"/></label>
        </div>
        {(attendanceMode==='gps'||attendanceMode==='gps_or_qr')&&<label className="mt-4 flex items-center gap-2 text-[13px] font-bold text-ink"><input name="qr_fallback_enabled" type="checkbox" defaultChecked={profile?.qr_fallback_enabled??true} className="h-4 w-4 accent-primary"/>위치 인증 실패 시 동적 QR 보완 허용</label>}

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[13px] font-bold text-ink">{facilityWord} 네트워크 인증</p>
          <p className="text-[12px] text-tertiary mt-1 leading-5">{facilityWord} Wi-Fi의 공인 IP를 등록해 출퇴근에 활용해요. 이 기기를 {facilityWord} Wi-Fi에 연결한 뒤 등록하세요. 추천 방식의 마지막 보완 수단이나 `Wi-Fi/IP만` 단독 방식으로 선택할 수 있어요.</p>
          {allowedIps.length > 0 && (
            <p className="mt-2 text-[12px] text-sub">등록된 네트워크 {allowedIps.length}개: {allowedIps.join(', ')}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={handleRegisterNetwork} disabled={netPending}
              className="h-11 flex-1 rounded-xl bg-ink text-white text-[13px] font-bold disabled:opacity-60">
              {netPending ? '확인 중...' : '지금 이 네트워크 등록'}
            </button>
            {allowedIps.length > 0 && (
              <button type="button" onClick={handleClearNetworks} disabled={netPending}
                className="h-11 px-4 rounded-xl border border-line text-[13px] text-sub disabled:opacity-60">
                모두 해제
              </button>
            )}
          </div>
          {netMessage && <p role="status" className="mt-2 text-[12px] text-sub">{netMessage}</p>}
        </div>
      </section>

      {error && <p role="alert" className="text-center text-[14px] text-warn mb-4">{error}</p>}
      {saved && <p role="status" className="text-center text-[14px] text-success mb-4">저장됐어요 ✓</p>}

      {/* BottomNav(z-30, ~56px+safe-area) 위에 떠야 한다 — z-40 + 하단 오프셋 */}
      <button
        type="submit"
        disabled={isPending}
        className="fixed bottom-[calc(60px+env(safe-area-inset-bottom))] inset-x-0 z-40 mx-auto max-w-app m-4 h-14 bg-primary text-white text-[17px] font-bold rounded-xl shadow-lg disabled:opacity-60"
      >
        {isPending ? '저장 중...' : '저장하기'}
      </button>
    </form>
  );
}
