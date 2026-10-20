'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { InstallAppButton } from '@/components/InstallAppButton';
import { TYPES, useDemoSelection } from './DemoSelection';

export function DemoLaunchPanel() {
  const { role, setRole, kind, setKind, demoHref } = useDemoSelection();
  const [message, setMessage] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const url = `https://itdot.co.kr/intro?role=${role}&kind=${kind}`;

  useEffect(() => {
    setMessage('');
    if (qrOpen && canvas.current) {
      void QRCode.toCanvas(canvas.current, url, { width: 176, margin: 2 })
        .catch(() => setMessage('QR을 만들지 못했어요. 아래 링크를 복사해 주세요.'));
    }
  }, [url, qrOpen]);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: '잇닿 시연', text: '가입·설치 없이 먼저 사용해 보세요.', url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage('선택한 시연 링크를 복사했어요.');
    } catch {
      setMessage('아래 주소를 길게 누르거나 선택해서 복사해 주세요.');
      setQrOpen(true);
    }
  }

  const gig = kind === 'gigworker';

  return (
    <section id="demo-start" className="mt-5 scroll-mt-4 rounded-2xl border border-line bg-white p-4 shadow-card" aria-label="시연 선택">
      <fieldset>
        <legend className="text-[13px] font-bold text-ink">어떤 화면을 볼까요?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {([{ id: 'admin', label: '사장님·관리자' }, { id: 'worker', label: '근무자' }] as const).map((item) => (
            <button key={item.id} type="button" aria-pressed={role === item.id} onClick={() => setRole(item.id)} className={`h-12 rounded-xl border text-[14px] font-bold ${role === item.id ? 'border-primary bg-primary-light text-primary' : 'border-line text-sub'}`}>{item.label}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-[13px] font-bold text-ink">{role === 'admin' ? '사업장 유형' : '근무 유형'}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(role === 'admin' ? TYPES : [{ id: 'hospital' as const, label: '병원·약국 근무' }, { id: 'gigworker' as const, label: '단기·초대 근무' }]).map((item) => (
            <button key={item.id} type="button" aria-pressed={role === 'worker' ? (item.id === 'gigworker') === gig : kind === item.id} onClick={() => setKind(item.id)} className={`min-h-11 rounded-xl border px-2 py-3 text-[13px] font-bold ${(role === 'worker' ? (item.id === 'gigworker') === gig : kind === item.id) ? 'border-primary bg-primary-light text-primary' : 'border-line text-sub'}`}>{item.label}</button>
          ))}
        </div>
      </fieldset>
      <p className="mt-4 text-[12px] leading-5 text-sub">{role === 'admin' ? (gig ? '근무자 초대 → 일정·출퇴근 확인 → 지급 기록' : '인력 모집 → 기존 직원·근태 관리 → 급여 검토') : (gig ? '초대 수락 → 내 근무 확인 → 출퇴근·지급 확인' : '직군 선택 → 근무 찾기 → 지원·출퇴근 확인')}</p>
      <a href={demoHref} className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-primary px-3 py-3 text-[15px] font-extrabold text-white">설치 없이 시연하기 →</a>
      <p className="mt-2 text-[11px] leading-4 text-sub">공용 시연 계정을 사용해요. 실제 개인정보는 입력하지 마세요.</p>
      <details className="mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer py-2 text-[13px] font-bold text-ink">홈 화면에 앱 추가하기 · 선택사항</summary>
        <p className="my-2 text-[12px] leading-5 text-sub">{role === 'admin' ? '관리자 앱으로 이동해 설치해요. 근무자 앱과 별개예요.' : '병원·약국과 단기 근무 모두 워커 앱 하나로 이용해요.'} 설치하지 않아도 웹에서 사용할 수 있어요.</p>
        {role === 'admin' ? <a href="https://admin.itdot.co.kr/login?install=1" className="flex min-h-12 items-center justify-center rounded-xl border border-line text-[14px] font-bold text-primary">관리자 앱 설치 안내 →</a> : <InstallAppButton label="워커 앱 홈 화면에 추가" />}
      </details>
      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        <button type="button" onClick={() => void share()} className="min-h-11 flex-1 rounded-xl bg-bg px-2 text-[12px] font-bold text-sub">선택한 시연 공유</button>
        <button type="button" aria-expanded={qrOpen} onClick={() => setQrOpen(!qrOpen)} className="min-h-11 flex-1 rounded-xl bg-bg px-2 text-[12px] font-bold text-sub">{qrOpen ? 'QR 닫기' : '다른 기기에서 보기 · QR'}</button>
      </div>
      {qrOpen && <div className="mt-3 flex flex-col items-center"><canvas ref={canvas} aria-label="선택한 시연 링크 QR" /><label className="w-full text-[11px] text-sub">공유 주소<input readOnly value={url} onFocus={(event) => event.target.select()} className="mt-1 w-full rounded-lg border border-line p-2 text-[12px]" /></label></div>}
      <p role="status" className="mt-2 text-[12px] text-primary">{message}</p>
    </section>
  );
}
