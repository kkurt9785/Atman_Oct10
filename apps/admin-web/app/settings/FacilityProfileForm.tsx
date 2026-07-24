'use client';

import { useTransition, useState } from 'react';
import { saveFacilityProfile, type FacilityProfile } from '@/lib/actions/facility';

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
          onClick={() => setOn(!on)}
          className={`w-12 h-7 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-line'}`}
        >
          <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
        </div>
      </div>
    </label>
  );
}

export function FacilityProfileForm({ profile }: { profile: FacilityProfile | null }) {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

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
        <h1 className="text-[24px] font-extrabold text-ink">병원 프로필</h1>
        <p className="text-[13px] text-sub mt-1">워커가 시프트 지원 전 병원 정보를 확인해요</p>
      </div>

      {/* 기본 정보 */}
      <section className="bg-white rounded-2xl p-5 mb-4">
        <p className="text-[13px] font-bold text-sub mb-4">기본 정보</p>

        <div className="mb-4">
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
        </div>
      </section>

      {/* 편의시설 */}
      <section className="bg-white rounded-2xl px-5 mb-4">
        <p className="text-[13px] font-bold text-sub pt-5 pb-2">편의시설</p>
        <Toggle name="has_parking" label="🚗  주차 가능" defaultChecked={profile?.has_parking ?? false} />
        <Toggle name="has_meals"   label="🍱  식사 제공" defaultChecked={profile?.has_meals ?? false} />
        <Toggle name="has_uniform" label="👕  유니폼 제공" defaultChecked={profile?.has_uniform ?? false} />
        <div className="h-1" />
      </section>

      {/* 병원 소개 */}
      <section className="bg-white rounded-2xl p-5 mb-6">
        <p className="text-[13px] font-bold text-sub mb-2">병원 소개</p>
        <p className="text-[12px] text-tertiary mb-3">워커에게 보여질 한 두 줄 소개입니다</p>
        <textarea
          name="intro"
          defaultValue={profile?.intro ?? ''}
          rows={4}
          placeholder="예: 직원 간 분위기가 좋고 신규 간호사 적응을 적극 지원합니다."
          className="w-full border border-line rounded-xl px-4 py-3 text-[15px] outline-none focus:border-primary resize-none"
        />
      </section>

      <section className="bg-white rounded-2xl p-5 mb-6">
        <p className="text-[13px] font-bold text-sub mb-1">출퇴근 인증</p>
        <p className="text-[12px] text-tertiary mb-4">실내 GPS 오차를 고려해 병원 환경에 맞게 선택하세요.</p>
        <label className="block text-[13px] text-sub mb-4">기본 인증 방식
          <select name="attendance_mode" defaultValue={profile?.attendance_mode??'gps_or_qr'} className="mt-1.5 w-full h-12 rounded-xl border border-line bg-white px-3 text-[14px]">
            <option value="gps_or_qr">추천 · GPS 우선, 실패 시 동적 QR</option>
            <option value="gps">GPS 원터치만</option><option value="gps_qr">GPS + 동적 QR 모두 확인</option>
            <option value="qr">동적 QR만</option>
            <option value="admin">관리자 승인</option>
          </select>
        </label>
        <div className="mb-4 rounded-xl bg-blue-50 p-3 text-[12px] leading-5 text-sub"><b className="text-primary">추천 방식</b><br/>평소에는 버튼 한 번으로 GPS 인증하고, 실내 위치가 불안정할 때만 병원 화면의 60초 QR로 보완합니다.</div>
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
        <label className="mt-4 flex items-center gap-2 text-[13px] font-bold text-ink"><input name="qr_fallback_enabled" type="checkbox" defaultChecked={profile?.qr_fallback_enabled??true} className="h-4 w-4 accent-primary"/>GPS 실패 시 동적 QR fallback 허용</label>
      </section>

      {error && <p className="text-center text-[14px] text-warn mb-4">{error}</p>}
      {saved && <p className="text-center text-[14px] text-success mb-4">저장됐어요 ✓</p>}

      <button
        type="submit"
        disabled={isPending}
        className="fixed bottom-0 inset-x-0 mx-auto max-w-app m-4 h-14 bg-primary text-white text-[17px] font-bold rounded-xl shadow-btn disabled:opacity-60"
      >
        {isPending ? '저장 중...' : '저장하기'}
      </button>
    </form>
  );
}
