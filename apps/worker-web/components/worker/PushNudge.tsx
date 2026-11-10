'use client';
import { useEffect, useState } from 'react';
import { enableShiftPush, getExistingSubscription } from '@/lib/push-subscribe';
import { useDemoSession } from '@/lib/demo-session';

// 홈 한 줄 — 새 근무 알림이 꺼져 있을 때만. '가만히 있어도 일이 들어온다'의 입구라 홈에 둔다. 시연 계정은 제외
// staffFirst(직원으로 연결된 사람)에게는 공고 얘기를 하지 않는다 — 공고를 찾지 않는 사람에게 '내 조건에 맞는 공고'는 남의 앱 문구다
export function PushNudge({ staffFirst = false }: { staffFirst?: boolean } = {}) {
  const demo = useDemoSession();
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (demo !== false) return;
    if (!('PushManager' in window) || typeof Notification === 'undefined' || Notification.permission === 'denied') return;
    let alive = true;
    void getExistingSubscription().then((sub) => { if (alive) setOff(!sub); }).catch(() => undefined);
    return () => { alive = false; };
  }, [demo]);
  if (demo !== false || !off) return null;
  async function turnOn() {
    setBusy(true);
    const result = await enableShiftPush().catch(() => 'unsupported' as const);
    setBusy(false);
    if (result === 'enabled') { setOff(false); return; }
    setNote(result === 'denied' ? '브라우저 알림 권한이 꺼져 있어요. 설정에서 허용해 주세요.' : '이 브라우저에서는 알림을 켤 수 없어요. 홈 화면에 설치한 앱에서 켜 주세요.');
  }
  return <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-3">
    <div className="min-w-0"><p className="text-sm font-bold text-ink">{staffFirst ? '알림이 꺼져 있어요' : '새 근무 알림이 꺼져 있어요'}</p><p className="text-xs text-sub">{note || (staffFirst ? '켜 두면 내 직장 소식을 놓치지 않아요.' : '내 조건에 맞는 공고가 올라오면 바로 알려 드려요.')}</p></div>
    <button type="button" disabled={busy} onClick={() => void turnOn()} className="h-10 shrink-0 rounded-xl bg-ink px-3 text-sm font-extrabold text-white disabled:opacity-60">{busy ? '켜는 중' : '켜기'}</button>
  </div>;
}
