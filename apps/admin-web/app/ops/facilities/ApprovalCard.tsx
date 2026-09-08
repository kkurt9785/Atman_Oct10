'use client';

import { useState, useTransition } from 'react';
import { approveSelfRegisteredFacility, rejectSelfRegisteredFacility, setRegistrationRequestStatus, type SelfRegisteredFacility, type RegistrationRequest } from '@/lib/actions/platform';

const TYPE_LABEL: Record<string, string> = {
  care_hospital: '요양병원', general_hospital: '종합병원', small_hospital: '병원·의원', nursing_home: '요양원', home_health: '방문간호', pharmacy: '약국',
};
const CL_LABEL: Record<string, string> = { '01': '상급종합', '11': '종합병원', '21': '병원', '28': '요양병원', '29': '정신병원', '31': '의원', '41': '치과병원', '51': '치과의원', '81': '약국', '91': '한방병원', '92': '한의원' };

function formatBrn(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
}

export function ApprovalCard({ facility: f }: { facility: SelfRegisteredFacility }) {
  const [brn, setBrn] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [isPending, startTransition] = useTransition();
  const mapUrl = f.lng != null && f.lat != null ? `https://map.kakao.com/link/map/${encodeURIComponent(f.name)},${f.lat},${f.lng}` : null;
  const hiraUrl = f.hira_ykiho ? `https://www.hira.or.kr/ra/hosp/getHealthMap.do?pgmid=HIRAA030002000000` : null;

  function approve() {
    setMessage(null);
    startTransition(async () => {
      const r = await approveSelfRegisteredFacility({ facilityId: f.id, brn });
      if (r.ok) setDone('approved'); else setMessage({ kind: 'error', text: r.error ?? '승인하지 못했어요.' });
    });
  }
  function reject() {
    setMessage(null);
    startTransition(async () => {
      const r = await rejectSelfRegisteredFacility({ facilityId: f.id, reason });
      if (r.ok) setDone('rejected'); else setMessage({ kind: 'error', text: r.error ?? '반려하지 못했어요.' });
    });
  }

  if (done) return (
    <article className="rounded-2xl bg-white p-4 opacity-70">
      <p className="text-[14px] font-bold text-ink">{f.name}</p>
      <p className="mt-1 text-[12px] text-sub">{done === 'approved' ? '승인 완료 · 등록한 관리자에게 알림을 보냈어요' : '반려 완료 · 사유를 관리자에게 보냈어요'}</p>
    </article>
  );

  return (
    <article className="rounded-2xl bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[16px] font-extrabold text-ink">{f.name}</p>
          <p className="mt-0.5 text-[12px] text-sub">{f.address_text}{f.contact_phone ? ` · ${f.contact_phone}` : ''}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-primary">{TYPE_LABEL[f.facility_type] ?? f.facility_type}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-sub">등록 관리자</dt><dd className="truncate text-ink">{f.admin_email ?? '없음'}</dd>
        <dt className="text-sub">등록 경로</dt><dd className="text-ink">{f.registration_source === 'self_hira' ? `심평원 대조됨${f.hira_cl_cd ? ` · ${CL_LABEL[f.hira_cl_cd] ?? f.hira_cl_cd}` : ''}` : '지도 검색(심평원 미대조)'}</dd>
        <dt className="text-sub">요양기관기호</dt><dd className="truncate font-mono text-ink">{f.hira_ykiho ?? '—'}</dd>
        <dt className="text-sub">등록일</dt><dd className="text-ink">{new Date(f.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-bold text-ink">핀 위치 지도에서 보기</a>}
        {hiraUrl && <a href={hiraUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-bold text-ink">심평원 병원찾기</a>}
        <a href={`https://www.ftc.go.kr/bizCommPop.do?wrkr_no=`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-bold text-ink">사업자 조회(공정위)</a>
      </div>

      {mode === 'idle' ? (
        <>
          <label className="mt-4 block text-[12px] font-bold text-sub">사업자등록번호 (사업자등록증 확인 후 입력)
            <input inputMode="numeric" value={brn} onChange={(e) => setBrn(formatBrn(e.target.value))} placeholder="000-00-00000" className="mt-1 h-11 w-full rounded-xl border border-line px-3 font-mono text-[15px] tracking-wider outline-none focus:border-primary" />
          </label>
          {message && <p role="alert" className="mt-2 text-[12px] font-bold text-warn">{message.text}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={approve} disabled={isPending || brn.replace(/\D/g, '').length !== 10} className="h-11 flex-1 rounded-xl bg-primary text-[14px] font-bold text-white disabled:opacity-40">{isPending ? '승인 중...' : '승인'}</button>
            <button type="button" onClick={() => { setMode('reject'); setMessage(null); }} disabled={isPending} className="h-11 rounded-xl border border-line px-4 text-[14px] font-bold text-sub">반려</button>
          </div>
        </>
      ) : (
        <>
          <label className="mt-4 block text-[12px] font-bold text-sub">반려 사유 (등록한 분에게 그대로 전달)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="예: 사업자등록증의 상호와 사업장명이 달라요. 실제 상호로 다시 등록해 주세요." className="mt-1 w-full resize-none rounded-xl border border-line p-3 text-[14px] outline-none focus:border-primary" />
          </label>
          {message && <p role="alert" className="mt-2 text-[12px] font-bold text-warn">{message.text}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={reject} disabled={isPending || reason.trim().length < 2} className="h-11 flex-1 rounded-xl bg-warn text-[14px] font-bold text-white disabled:opacity-40">{isPending ? '반려 중...' : '반려하고 등록 취소'}</button>
            <button type="button" onClick={() => setMode('idle')} disabled={isPending} className="h-11 rounded-xl border border-line px-4 text-[14px] font-bold text-sub">돌아가기</button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-tertiary">반려하면 사업장이 비활성화되고 소유가 해제돼요. 같은 관리자가 다시 등록할 수 있어요.</p>
        </>
      )}
    </article>
  );
}

export function RequestCard({ request: r }: { request: RegistrationRequest }) {
  const [status, setStatus] = useState(r.status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  function set(next: 'reviewing' | 'approved' | 'rejected' | 'duplicate') {
    setError('');
    startTransition(async () => {
      const res = await setRegistrationRequestStatus({ requestId: r.id, status: next });
      if (res.ok) setStatus(next); else setError(res.error ?? '처리하지 못했어요.');
    });
  }
  const closed = status === 'approved' || status === 'rejected' || status === 'duplicate';
  return (
    <article className={`rounded-2xl bg-white p-4 ${closed ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="text-[15px] font-extrabold text-ink">{r.facility_name}</p><p className="mt-0.5 text-[12px] text-sub">{r.address_text}</p></div>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-primary">{TYPE_LABEL[r.facility_type] ?? r.facility_type}</span>
      </div>
      <p className="mt-2 text-[13px] text-ink">{r.contact_name} · <a href={`tel:${r.contact_phone}`} className="font-bold text-primary">{r.contact_phone}</a></p>
      {r.note && <p className="mt-1 rounded-lg bg-surface p-2 text-[12px] text-sub">{r.note}</p>}
      <p className="mt-2 text-[11px] text-tertiary">{new Date(r.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 상태 {status}</p>
      {error && <p role="alert" className="mt-2 text-[12px] font-bold text-warn">{error}</p>}
      {!closed && (
        <div className="mt-3 flex flex-wrap gap-2">
          {status !== 'reviewing' && <button type="button" onClick={() => set('reviewing')} disabled={isPending} className="h-9 rounded-lg border border-line px-3 text-[12px] font-bold text-ink">연락 중</button>}
          <button type="button" onClick={() => set('approved')} disabled={isPending} className="h-9 rounded-lg bg-primary px-3 text-[12px] font-bold text-white">처리 완료</button>
          <button type="button" onClick={() => set('duplicate')} disabled={isPending} className="h-9 rounded-lg border border-line px-3 text-[12px] font-bold text-sub">이미 등록됨</button>
          <button type="button" onClick={() => set('rejected')} disabled={isPending} className="h-9 rounded-lg border border-line px-3 text-[12px] font-bold text-sub">해당 없음</button>
        </div>
      )}
    </article>
  );
}
