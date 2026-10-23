'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type FacilityDetail = {
  id: string;
  name: string;
  facility_type: string;
  address_text: string;
  bed_count: number | null;
  main_department: string | null;
  has_parking: boolean;
  has_meals: boolean;
  has_uniform: boolean;
  emr_system: string | null;
  intro: string | null;
  pharmacy_type: string | null;
  pharmacy_system: string | null;
  average_daily_prescriptions: number | null;
  handover_minutes: number | null;
};
type FacilityTrust = { approved_at: string | null; registration_source: string | null; business_status: string | null };

const FACILITY_TYPE_LABEL: Record<string, string> = {
  care_hospital:   '요양병원',
  general_hospital:'종합병원',
  small_hospital:  '병원',
  clinic:          '의원',
  nursing_home:    '요양원',
  home_health:     '방문간호',
  pharmacy:        '약국',
};

function AmenityChip({ icon, label, active }: { icon: string; label: string; active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-bg rounded-full text-[12px] font-semibold text-sub">
      {icon} {label}
    </span>
  );
}

type Props = {
  facilityId: string;
  facilityName: string;
  onClose: () => void;
};

export function FacilitySheet({ facilityId, facilityName, onClose }: Props) {
  const [facility, setFacility] = useState<FacilityDetail | null>(null);
  // 사업자 확인 표시용(승인·국세청 상태). 별도 조회라 컬럼 권한이 없어도 본문은 그대로 뜬다
  const [trust, setTrust] = useState<FacilityTrust | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(false); setFacility(null); setTrust(null);
      try {
        const { data: fac, error: detailError } = await supabase
          .from('facilities')
          .select('id, name, facility_type, address_text, bed_count, main_department, has_parking, has_meals, has_uniform, emr_system, intro, pharmacy_type, pharmacy_system, average_daily_prescriptions, handover_minutes')
          .eq('id', facilityId)
          .single();
      if (detailError || !fac) throw new Error('facility unavailable');
      if (!active) return;
      setFacility(fac);
      void supabase.from('facilities').select('approved_at, registration_source, business_status').eq('id', facilityId).maybeSingle()
        .then(({ data }) => { if (active && data) setTrust(data as FacilityTrust); }, () => undefined);
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [facilityId, retry]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-[24px] z-50 max-h-[85vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {/* 핸들 */}
        <div className="sticky top-0 bg-white pt-4 pb-3 px-6">
          <div className="w-10 h-1 bg-line rounded-full mx-auto mb-4" />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[13px] text-tertiary mb-0.5">
                {facility ? FACILITY_TYPE_LABEL[facility.facility_type] ?? '의료 사업장' : ''}
              </p>
              <h2 className="text-[20px] font-extrabold text-ink">{facilityName}</h2>
              {trust?.business_status === 'active' && <p className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700">사업자등록 상태 확인 ✓</p>}
            </div>
            <button onClick={onClose} className="text-[22px] text-tertiary leading-none mt-1">✕</button>
          </div>
        </div>

        <div className="px-6 pb-10">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div role="alert" className="rounded-card bg-bg p-4">
              <p className="text-sm text-sub">사업장 정보를 불러오지 못했어요.</p>
              <button onClick={() => setRetry(value => value + 1)} className="min-h-11 font-bold text-primary">다시 불러오기</button>
            </div>
          ) : (
            <>

              {facility?.facility_type==='pharmacy'&&(facility.pharmacy_type||facility.pharmacy_system||facility.average_daily_prescriptions||facility.handover_minutes)&&(
                <div className="mb-4 grid grid-cols-2 gap-2 rounded-card bg-bg p-4">
                  {facility.pharmacy_type&&<div><p className="text-[11px] text-tertiary">약국 유형</p><b className="text-[14px]">{facility.pharmacy_type}</b></div>}
                  {facility.pharmacy_system&&<div><p className="text-[11px] text-tertiary">전산 프로그램</p><b className="text-[14px]">{facility.pharmacy_system}</b></div>}
                  {facility.average_daily_prescriptions!=null&&<div><p className="text-[11px] text-tertiary">일평균 처방전</p><b className="text-[14px]">{facility.average_daily_prescriptions}건</b></div>}
                  {facility.handover_minutes!=null&&<div><p className="text-[11px] text-tertiary">인수인계</p><b className="text-[14px]">{facility.handover_minutes}분</b></div>}
                </div>
              )}

              {/* 위치 */}
              {facility?.address_text && (
                <p className="text-[13px] text-sub mb-4 flex items-start gap-1">
                  <span>📍</span>
                  <span>{facility.address_text}</span>
                </p>
              )}

              {/* 편의시설 칩 */}
              {(facility?.has_parking || facility?.has_meals || facility?.has_uniform) && (
                <div className="flex flex-wrap gap-2 mb-4">
                  <AmenityChip icon="🚗" label="주차 가능" active={facility?.has_parking ?? false} />
                  <AmenityChip icon="🍱" label="식사 제공" active={facility?.has_meals ?? false} />
                  <AmenityChip icon="👕" label="유니폼 제공" active={facility?.has_uniform ?? false} />
                </div>
              )}

              {/* 병상 / 병동 */}
              {(facility?.bed_count || facility?.main_department) && (
                <div className="bg-bg rounded-card p-4 mb-4 flex gap-6">
                  {facility?.bed_count && (
                    <div>
                      <p className="text-[11px] text-tertiary mb-0.5">병상</p>
                      <p className="text-[16px] font-extrabold text-ink">{facility.bed_count}병상</p>
                    </div>
                  )}
                  {facility?.main_department && (
                    <div>
                      <p className="text-[11px] text-tertiary mb-0.5">병동</p>
                      <p className="text-[16px] font-extrabold text-ink">{facility.main_department}</p>
                    </div>
                  )}
                  {facility?.emr_system && (
                    <div>
                      <p className="text-[11px] text-tertiary mb-0.5">EMR</p>
                      <p className="text-[16px] font-extrabold text-ink">{facility.emr_system}</p>
                    </div>
                  )}
                </div>
              )}

              {/* 사업장 소개 */}
              {facility?.intro && (
                <div className="mb-5">
                  <p className="text-[13px] font-extrabold text-ink mb-2">💬 {facility.facility_type==='pharmacy'?'약국':'병원'} 소개</p>
                  <p className="text-[13px] text-sub leading-relaxed">&quot;{facility.intro}&quot;</p>
                </div>
              )}

              {/* 워커 권한의 일부 기록을 사업장 전체 통계로 표시하지 않는다. */}
              <p className="mt-4 text-xs leading-relaxed text-sub">사업장 전체 근무 이력과 평점은 현재 제공하지 않아요. 지원 전 공고의 근무 조건을 확인해 주세요.</p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
