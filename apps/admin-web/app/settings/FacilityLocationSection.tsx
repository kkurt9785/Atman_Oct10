'use client';

import { useState, useTransition } from 'react';
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

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (form.lng == null || form.lat == null) { setMessage({ kind: 'error', text: '지도에서 위치를 먼저 지정해 주세요.' }); return; }
    setMessage(null);
    const lng = form.lng, lat = form.lat;
    startTransition(async () => {
      const result = await saveFacilityLocation({ name: form.name.trim(), addressText: form.addressText.trim(), phone: form.phone.trim(), lng, lat });
      setMessage(result.ok ? { kind: 'ok', text: '저장됐어요 ✓ 출퇴근 인증도 새 위치 기준으로 바뀌었어요.' } : { kind: 'error', text: result.error ?? '저장하지 못했어요.' });
    });
  }

  return (
    <form onSubmit={submit} className="px-4 pt-5">
      <section className="rounded-2xl bg-white p-5">
        <p className="mb-1 text-[13px] font-bold text-sub">{facilityWord} 정보·위치</p>
        <p className="mb-4 text-[12px] leading-5 text-tertiary">주소와 핀은 워커에게 보이는 위치이자 출퇴근 인증(반경 {gpsRadiusMeters}m)의 기준이에요.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-[13px] text-sub">{facilityWord}명<input value={form.name} disabled={!canEdit} onChange={e => setForm(c => ({ ...c, name: e.target.value }))} className="mt-1.5 h-12 w-full rounded-xl border border-line px-4 text-[15px] outline-none focus:border-primary disabled:bg-surface" /></label>
          <label className="col-span-2 text-[13px] text-sub">주소<input value={form.addressText} disabled={!canEdit} onChange={e => setForm(c => ({ ...c, addressText: e.target.value }))} placeholder="도로명 주소" className="mt-1.5 h-12 w-full rounded-xl border border-line px-4 text-[15px] outline-none focus:border-primary disabled:bg-surface" /></label>
          <label className="col-span-2 text-[13px] text-sub">대표 전화<input inputMode="tel" value={form.phone} disabled={!canEdit} onChange={e => setForm(c => ({ ...c, phone: e.target.value }))} placeholder="031-000-0000" className="mt-1.5 h-12 w-full rounded-xl border border-line px-4 text-[15px] outline-none focus:border-primary disabled:bg-surface" /></label>
        </div>
        <p className="mt-4 text-[13px] text-sub">출퇴근 인증 위치</p>
        {hasPin ? (
          <FacilityPinMap className="mt-1.5" lng={form.lng as number} lat={form.lat as number} radiusMeters={gpsRadiusMeters} onChange={({ lng, lat }) => canEdit && setForm(c => ({ ...c, lng, lat }))} />
        ) : (
          <p className="mt-1.5 rounded-xl bg-amber-50 p-3 text-[12px] leading-5 text-amber-700">아직 위치가 없어요. 잇닿에 문의해 주시면 주소 기준으로 잡아 드려요.</p>
        )}
        {message && <p role={message.kind === 'ok' ? 'status' : 'alert'} className={`mt-3 text-[13px] font-bold ${message.kind === 'ok' ? 'text-success' : 'text-warn'}`}>{message.text}</p>}
        {canEdit && <button type="submit" disabled={isPending || !hasPin || form.name.trim().length < 2 || form.addressText.trim().length < 5} className="mt-4 h-12 w-full rounded-xl bg-ink text-[14px] font-bold text-white disabled:opacity-50">{isPending ? '저장 중...' : '정보·위치 저장'}</button>}
      </section>
    </form>
  );
}
