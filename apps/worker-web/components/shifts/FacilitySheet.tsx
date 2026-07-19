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
};

type Stats = {
  avgRating: number | null;
  completedCount: number;
  reapplyRate: number | null;
};

const FACILITY_TYPE_LABEL: Record<string, string> = {
  care_hospital:   '요양병원',
  general_hospital:'종합병원',
  small_hospital:  '병원',
  clinic:          '의원',
  nursing_home:    '요양원',
  home_health:     '방문간호',
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 14 14" fill={i <= Math.round(rating) ? '#FFC800' : '#E5E8EB'}>
          <path d="M7 1l1.545 3.09L12 4.635l-2.5 2.41.59 3.41L7 8.75l-3.09 1.705.59-3.41L2 4.635l3.455-.545z"/>
        </svg>
      ))}
      <span className="text-[13px] font-bold text-ink ml-1">{rating.toFixed(1)}</span>
    </span>
  );
}

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
  const [stats, setStats] = useState<Stats>({ avgRating: null, completedCount: 0, reapplyRate: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: fac }, { data: shiftIds }] = await Promise.all([
        supabase
          .from('facilities')
          .select('id, name, facility_type, address_text, bed_count, main_department, has_parking, has_meals, has_uniform, emr_system, intro')
          .eq('id', facilityId)
          .single(),
        supabase
          .from('shifts')
          .select('id')
          .eq('facility_id', facilityId),
      ]);

      setFacility(fac);

      const ids = (shiftIds ?? []).map((s: { id: string }) => s.id);
      if (ids.length === 0) { setLoading(false); return; }

      const [{ data: apps }, { data: reviews }] = await Promise.all([
        supabase
          .from('shift_applications')
          .select('worker_id')
          .in('shift_id', ids)
          .in('status', ['accepted', 'completed']),
        supabase
          .from('shift_reviews')
          .select('rating')
          .in('shift_id', ids),
      ]);

      const completedCount = apps?.length ?? 0;
      let reapplyRate: number | null = null;
      if (completedCount >= 5) {
        const counts: Record<string, number> = {};
        (apps ?? []).forEach((a: { worker_id: string }) => {
          counts[a.worker_id] = (counts[a.worker_id] ?? 0) + 1;
        });
        const total = Object.keys(counts).length;
        const reapplied = Object.values(counts).filter((c) => c > 1).length;
        reapplyRate = Math.round((reapplied / total) * 100);
      }

      let avgRating: number | null = null;
      if (reviews && reviews.length >= 3) {
        const sum = reviews.reduce((acc: number, r: { rating: number }) => acc + r.rating, 0);
        avgRating = Math.round((sum / reviews.length) * 10) / 10;
      }

      setStats({ avgRating, completedCount, reapplyRate });
      setLoading(false);
    }
    load();
  }, [facilityId]);

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
                {facility ? FACILITY_TYPE_LABEL[facility.facility_type] ?? '병원' : ''}
              </p>
              <h2 className="text-[20px] font-extrabold text-ink">{facilityName}</h2>
            </div>
            <button onClick={onClose} className="text-[22px] text-tertiary leading-none mt-1">✕</button>
          </div>
        </div>

        <div className="px-6 pb-10">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* 별점 */}
              {stats.avgRating !== null && (
                <div className="mb-4">
                  <Stars rating={stats.avgRating} />
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

              {/* 병원 소개 */}
              {facility?.intro && (
                <div className="mb-5">
                  <p className="text-[13px] font-extrabold text-ink mb-2">💬 병원 소개</p>
                  <p className="text-[13px] text-sub leading-relaxed">&quot;{facility.intro}&quot;</p>
                </div>
              )}

              {/* 워커 통계 */}
              {stats.completedCount >= 5 && (
                <div className="border border-line rounded-card p-4">
                  <p className="text-[13px] font-extrabold text-ink mb-3">최근 6개월</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[13px] text-sub">
                      <span className="text-success">✔</span>
                      <span><strong className="text-ink">{stats.completedCount}명</strong> 근무 완료</span>
                    </div>
                    {stats.reapplyRate !== null && (
                      <div className="flex items-center gap-2 text-[13px] text-sub">
                        <span className="text-success">✔</span>
                        <span>재지원율 <strong className="text-primary text-[15px]">{stats.reapplyRate}%</strong></span>
                      </div>
                    )}
                  </div>
                  {stats.reapplyRate !== null && stats.reapplyRate >= 60 && (
                    <p className="mt-3 text-[12px] text-tertiary bg-primary-light rounded-lg px-3 py-2">
                      이 병원에서 근무한 간호사의 {stats.reapplyRate}%가 다시 지원했어요
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
