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
// 약국 정보 컬럼은 근무자 컬럼 권한 목록에 늦게 들어갔다 — 본문 조회에 섞으면 권한 오류 하나로 시트 전체가 실패한다
type PharmacyInfo = { pharmacy_type: string | null; pharmacy_system: string | null; average_daily_prescriptions: number | null; handover_minutes: number | null };
type FacilityTrust = { approved_at: string | null; registration_source: string | null; business_status: string | null };
// 직업안정법 §25(2026-12-10) — 체불사업주 명단 공개·산재 공표 사업장이면 구직자에게 그 사실을 게재한다
type PublicFlags = { public_flag_wage_arrears: boolean | null; public_flag_industrial_accident: boolean | null };
const REPORT_REASONS: [string, string][] = [['false_ad', '허위·과장 광고'], ['wage_mismatch', '임금·근무 조건이 공고와 달라요'], ['contact_mismatch', '연락처·주소가 맞지 않아요'], ['identity', '사업장 신원이 의심돼요'], ['other', '기타']];

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
  shiftId?: string | null;
  onClose: () => void;
};

export function FacilitySheet({ facilityId, facilityName, shiftId = null, onClose }: Props) {
  const [facility, setFacility] = useState<FacilityDetail | null>(null);
  const [pharmacy, setPharmacy] = useState<PharmacyInfo | null>(null);
  // 사업자 확인 표시용(승인·국세청 상태). 별도 조회라 컬럼 권한이 없어도 본문은 그대로 뜬다
  const [trust, setTrust] = useState<FacilityTrust | null>(null);
  const [flags, setFlags] = useState<PublicFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // 허위·과장 공고 신고 창구 — 운영자가 /ops/safety 에서 검토한다. 신고자 정보는 사업장에 전달하지 않는다.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('false_ad');
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportResult, setReportResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(false); setFacility(null); setPharmacy(null); setTrust(null); setFlags(null);
      // 확인 표시·공표 정보·약국 정보는 각자 조회한다 — 하나가 실패해도 본문·공표 문구·신고 입구는 그대로 뜬다
      void supabase.from('facilities').select('approved_at, registration_source, business_status').eq('id', facilityId).maybeSingle()
        .then(({ data }) => { if (active && data) setTrust(data as FacilityTrust); }, () => undefined);
      void supabase.from('facilities').select('public_flag_wage_arrears, public_flag_industrial_accident').eq('id', facilityId).maybeSingle()
        .then(({ data }) => { if (active && data) setFlags(data as PublicFlags); }, () => undefined);
      void supabase.from('facilities').select('pharmacy_type, pharmacy_system, average_daily_prescriptions, handover_minutes').eq('id', facilityId).maybeSingle()
        .then(({ data }) => { if (active && data) setPharmacy(data as PharmacyInfo); }, () => undefined);
      try {
        const { data: fac, error: detailError } = await supabase
          .from('facilities')
          .select('id, name, facility_type, address_text, bed_count, main_department, has_parking, has_meals, has_uniform, emr_system, intro')
          .eq('id', facilityId)
          .single();
        if (detailError || !fac) throw new Error('facility unavailable');
        if (active) setFacility(fac);
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
              {flags?.public_flag_wage_arrears && <p role="note" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-bold leading-5 text-amber-800">고용노동부가 임금체불 사업주 명단을 공개 중인 사업장이에요. 지원 전 근무 조건과 지급 방식을 꼭 확인하세요.</p>}
              {flags?.public_flag_industrial_accident && <p role="note" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-bold leading-5 text-amber-800">최근 3년 산업재해 발생건수가 공표된 사업장이에요.</p>}
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

              {facility?.facility_type==='pharmacy'&&pharmacy&&(pharmacy.pharmacy_type||pharmacy.pharmacy_system||pharmacy.average_daily_prescriptions||pharmacy.handover_minutes)&&(
                <div className="mb-4 grid grid-cols-2 gap-2 rounded-card bg-bg p-4">
                  {pharmacy.pharmacy_type&&<div><p className="text-[11px] text-tertiary">약국 유형</p><b className="text-[14px]">{pharmacy.pharmacy_type}</b></div>}
                  {pharmacy.pharmacy_system&&<div><p className="text-[11px] text-tertiary">전산 프로그램</p><b className="text-[14px]">{pharmacy.pharmacy_system}</b></div>}
                  {pharmacy.average_daily_prescriptions!=null&&<div><p className="text-[11px] text-tertiary">일평균 처방전</p><b className="text-[14px]">{pharmacy.average_daily_prescriptions}건</b></div>}
                  {pharmacy.handover_minutes!=null&&<div><p className="text-[11px] text-tertiary">인수인계</p><b className="text-[14px]">{pharmacy.handover_minutes}분</b></div>}
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

          {/* 직업안정법 §25 — 허위·과장 공고 신고. 사업장 정보 조회가 실패해도 신고 입구는 남긴다 */}
          {!loading && (
            <div className="mt-5 border-t border-line pt-4">
              {!reportOpen && !reportResult && (
                <button type="button" onClick={() => setReportOpen(true)} className="min-h-11 text-[13px] font-bold text-sub underline">공고 내용이 사실과 다른가요? 신고하기</button>
              )}
              {reportOpen && !reportResult && (
                <form className="space-y-3" onSubmit={async event => {
                  event.preventDefault();
                  if (reportBusy) return;
                  setReportBusy(true);
                  try {
                    const { error: rpcError } = await supabase.rpc('report_job_posting', { p_facility_id: facilityId, p_shift_id: shiftId, p_reason: reportReason, p_note: reportNote.trim() });
                    if (rpcError) setReportResult({ ok: false, text: rpcError.message || '신고를 접수하지 못했어요. 다시 시도해 주세요.' });
                    else setReportResult({ ok: true, text: '신고가 접수됐어요. 운영자가 확인한 뒤 필요한 조치를 해요. 신고자 정보는 사업장에 전달하지 않아요.' });
                  } catch {
                    setReportResult({ ok: false, text: '연결을 확인하고 다시 시도해 주세요.' });
                  } finally {
                    setReportBusy(false);
                  }
                }}>
                  <p className="text-[13px] font-extrabold text-ink">무엇이 문제인가요?</p>
                  <select value={reportReason} onChange={e => setReportReason(e.target.value)} disabled={reportBusy} aria-label="신고 사유" className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-[14px]">
                    {REPORT_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <textarea value={reportNote} onChange={e => setReportNote(e.target.value)} disabled={reportBusy} maxLength={1000} rows={3} placeholder="어떤 점이 공고와 달랐는지 적어 주세요 (선택)" aria-label="신고 내용" className="w-full rounded-xl border border-line p-3 text-[14px]" />
                  <div className="flex gap-2">
                    <button type="submit" disabled={reportBusy} className="min-h-12 flex-1 rounded-xl bg-primary text-[14px] font-bold text-white disabled:opacity-50">{reportBusy ? '접수 중…' : '신고 접수'}</button>
                    <button type="button" disabled={reportBusy} onClick={() => setReportOpen(false)} className="min-h-12 rounded-xl border border-line px-4 text-[14px] font-bold text-sub">취소</button>
                  </div>
                </form>
              )}
              {reportResult && <p role="status" className={`rounded-xl p-3 text-[13px] font-bold leading-5 ${reportResult.ok ? 'bg-bg text-ink' : 'bg-amber-50 text-amber-800'}`}>{reportResult.text}</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
