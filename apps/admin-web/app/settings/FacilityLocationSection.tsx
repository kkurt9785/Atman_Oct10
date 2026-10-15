'use client';

import { useRef, useState, useTransition } from 'react';
import { saveFacilityLocation, type FacilityLocation } from '@/lib/actions/facility';
import { FacilityPinMap } from '@/components/FacilityPinMap';

// 사업장명·주소·전화 + 출퇴근 인증 핀. 프로필 폼과 별도 form — 중첩 form 방지, 저장 단위도 다름.
export function FacilityLocationSection({ initial, facilityWord, gpsRadiusMeters, canEdit }: {
  initial: FacilityLocation; facilityWord: string; gpsRadiusMeters: number; canEdit: boolean;
}) {
  const [form, setForm] = useState({ name: initial.name, addressText: initial.addressText, phone: initial.phone, lng: initial.lng, lat: initial.lat });
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const hasPin = form.lng != null && form.lat != null;
  const saving=useRef(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(saving.current||!canEdit)return;
    if (form.lng == null || form.lat == null) { setMessage({ kind: 'error', text: '지도에서 위치를 먼저 지정해 주세요.' }); return; }
    setMessage(null);
    const lng = form.lng, lat = form.lat;
    saving.current=true;
    startTransition(async () => {
      try {
      const result = await saveFacilityLocation({ name: form.name.trim(), addressText: form.addressText.trim(), phone: form.phone.trim(), lng, lat });
      setMessage(result.ok ? { kind: 'ok', text: '저장됐어요 ✓ 출퇴근 인증도 새 위치 기준으로 바뀌었어요.' } : { kind: 'error', text: result.error ?? '저장하지 못했어요.' });
      } catch {setMessage({kind:'error',text:'저장 결과를 확인하지 못했어요. 위치를 다시 확인한 뒤 시도해 주세요.'});}
      finally {saving.current=false;}
    });
  }

  return (
    <form onSubmit={submit} className="px-4 pt-5">
      <section className="rounded-2xl bg-white p-5">
        <p className="mb-1 text-[0.8125rem] font-bold text-sub">{facilityWord} 정보·위치</p>
        <p className="mb-4 text-[0.75rem] leading-5 text-tertiary">주소와 핀은 근무자에게 보이는 위치이자 출퇴근 인증(반경 {gpsRadiusMeters}m)의 기준이에요.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-[0.8125rem] text-sub">{facilityWord}명<input value={form.name} disabled={!canEdit} onChange={e => setForm(c => ({ ...c, name: e.target.value }))} className="mt-1.5 h-12 w-full rounded-xl border border-line px-4 text-[0.9375rem] outline-none focus:border-primary disabled:bg-surface" /></label>
          <label className="col-span-2 text-[0.8125rem] text-sub">주소·현장 안내 (선택)<input value={form.addressText} disabled={!canEdit} onChange={e => setForm(c => ({ ...c, addressText: e.target.value }))} placeholder="주소 없이 지도 지정 가능 · 예: 행사장 동문" className="mt-1.5 h-12 w-full rounded-xl border border-line px-4 text-[0.9375rem] outline-none focus:border-primary disabled:bg-surface" /></label>
          <label className="col-span-2 text-[0.8125rem] text-sub">대표 전화<input inputMode="tel" value={form.phone} disabled={!canEdit} onChange={e => setForm(c => ({ ...c, phone: e.target.value }))} placeholder="031-000-0000" className="mt-1.5 h-12 w-full rounded-xl border border-line px-4 text-[0.9375rem] outline-none focus:border-primary disabled:bg-surface" /></label>
        </div>
        <p className="mt-4 text-[0.8125rem] text-sub">출퇴근 인증 위치</p>
        {hasPin ? (
          <FacilityPinMap className="mt-1.5" lng={form.lng as number} lat={form.lat as number} radiusMeters={gpsRadiusMeters} readOnly={!canEdit} onChange={({ lng, lat }) => canEdit && setForm(c => ({ ...c, lng, lat }))} />
        ) : (
          <div className="mt-1.5">
            <p className="rounded-xl bg-amber-50 p-3 text-[0.75rem] leading-5 text-amber-700">아직 출퇴근 인증 위치가 없어요. 지금 사업장 안에 계시면 아래 버튼 한 번으로 정해집니다.</p>
            {canEdit && <><p className="my-2 text-xs text-sub">현장에 없어도 지도를 이동해 근무지를 누를 수 있어요. 처음 보이는 핀은 저장되지 않아요.</p><FacilityPinMap className="mt-2" lng={126.978} lat={37.5665} radiusMeters={gpsRadiusMeters} onChange={({ lng, lat }) => setForm(c => ({ ...c, lng, lat }))} /></>}
          </div>
        )}
        {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={`mt-3 text-[0.8125rem] font-bold ${message.kind === 'ok' ? 'text-success' : 'text-warn'}`}>{message.text}</p>}
        {hasPin && <p className="mt-3 text-xs text-sub">기준점: {form.lat?.toFixed(6)}, {form.lng?.toFixed(6)} · 변경하면 이 현장의 다음 인증부터 적용돼요.</p>}
        {canEdit && <button type="submit" disabled={isPending || !hasPin || form.name.trim().length < 2} className="mt-4 h-12 w-full rounded-xl bg-ink text-[0.875rem] font-bold text-white disabled:opacity-50">{isPending ? '저장 중...' : '정보·위치 저장'}</button>}
      </section>
    </form>
  );
}
