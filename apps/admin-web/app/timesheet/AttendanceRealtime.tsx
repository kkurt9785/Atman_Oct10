'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';
import { getAdminPushSubscription, subscribeToAdminPush } from '@/lib/push-subscribe';

type AuthLog = {
  action: 'check_in' | 'check_out';
  result: 'SUCCESS' | 'FAIL';
  staff_id: string | null;
  application_id: string | null;
  failure_reason: string | null;
};

const FAILURE_LABEL: Record<string, string> = {
  OUT_OF_RANGE: '사업장 반경 밖', GPS_ERROR: '위치 확인 실패', GPS_ACCURACY_LOW: 'GPS 정확도 낮음',
  QR_EXPIRED: 'QR 만료', QR_INVALID: 'QR 무효', HOSPITAL_MISMATCH: '사업장 정보 불일치',
  TIME_NOT_ALLOWED: '인증 가능시간 아님', NOT_ASSIGNED: '배정 정보 없음', ADMIN_REQUIRED: '관리자 승인 필요',
};

async function resolveName(log: AuthLog): Promise<string> {
  if (log.staff_id) {
    const { data } = await supabase.from('facility_staff').select('name').eq('id', log.staff_id).maybeSingle();
    if (data?.name) return data.name;
  }
  if (log.application_id) {
    const { data } = await supabase.from('shift_applications').select('workers(name)').eq('id', log.application_id).maybeSingle();
    const workers = data?.workers as unknown as { name?: string } | { name?: string }[] | null;
    const worker = Array.isArray(workers) ? workers[0] : workers;
    if (worker?.name) return worker.name;
  }
  return '근로자';
}

export function AttendanceRealtime({ facilityId }: { facilityId: string | null }) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'fallback'>('connecting');
  const [hasFreshRecord, setHasFreshRecord] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getAdminPushSubscription().then((subscription) => setPushEnabled(Boolean(subscription))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!facilityId) return;
    const channel = supabase.channel(`admin-attendance-${facilityId}`).on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'attendance_auth_logs', filter: `facility_id=eq.${facilityId}` },
      async ({ new: raw }) => {
        const log = raw as AuthLog;
        const name = await resolveName(log);
        const action = log.action === 'check_in' ? '출근' : '퇴근';
        const message = log.result === 'SUCCESS'
          ? `${name}님이 ${action} 처리됐어요.`
          : `${name}님의 ${action} 인증 실패 · ${FAILURE_LABEL[log.failure_reason ?? ''] ?? '확인 필요'}`;
        setToast(message);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(null), 5000);
        setHasFreshRecord(true);
        setLastUpdatedAt(new Date());
        router.refresh();
      },
    ).subscribe((status) => {
      if (status === 'SUBSCRIBED') setConnection('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnection('fallback');
    });
    const fallback = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setLastUpdatedAt(new Date());
      router.refresh();
    }, 30_000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [facilityId, router]);

  function refreshNow() {
    setHasFreshRecord(false);
    setLastUpdatedAt(new Date());
    router.refresh();
  }

  async function enablePush() {
    setPushMessage(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('다시 로그인한 뒤 알림을 켜 주세요.');
      const subscription = await subscribeToAdminPush();
      if (!subscription) throw new Error('브라우저에서 알림 권한을 허용해 주세요.');
      const { error } = await supabase.from('push_subscriptions').upsert({
        worker_id: user.id,
        endpoint: subscription.endpoint,
        subscription: subscription.toJSON(),
      }, { onConflict: 'worker_id,endpoint' });
      if (error) throw error;
      setPushEnabled(true);
      setPushMessage('지각·인증 실패·조기 퇴근 알림을 받을게요.');
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : '알림을 켜지 못했어요.');
    }
  }

  return <>
    {hasFreshRecord&&<button type="button" onClick={refreshNow} className="mt-4 flex w-full items-center justify-between rounded-2xl bg-primary px-4 py-3 text-left text-white shadow-btn"><span><b className="block text-[0.8125rem]">새 출퇴근 기록이 들어왔어요</b><span className="mt-0.5 block text-[0.6875rem] text-white/80">근태 현황에 자동으로 반영했어요.</span></span><span className="text-[0.75rem] font-extrabold">새 기록 보기 →</span></button>}
    {/* 연결 상태는 한 줄로 — 예전엔 설명 문단까지 110px를 차지해 '확인 필요' 목록을 밀어냈다 */}
    <section className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-white px-4 py-2.5 shadow-card">
      <span className={`h-2 w-2 shrink-0 rounded-full ${connection==='live'?'bg-success':'bg-amber-500'}`} aria-hidden/>
      <p className="min-w-0 flex-1 truncate text-[0.75rem] font-bold text-sub">{connection==='live'?'실시간 반영 중':'자동으로 새로 보는 중'}{lastUpdatedAt?` · ${lastUpdatedAt.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})} 갱신`:''}</p>
      <button type="button" onClick={refreshNow} className="h-8 shrink-0 rounded-lg px-2 text-[0.75rem] font-bold text-sub">새로 보기</button>
      <button type="button" onClick={enablePush} disabled={pushEnabled} className={`h-8 shrink-0 rounded-lg px-3 text-[0.75rem] font-extrabold ${pushEnabled?'bg-success/10 text-success':'bg-primary text-white'}`}>{pushEnabled?'알림 켜짐':'알림 켜기'}</button>
    </section>
    {pushMessage&&<p role="status" className="mt-1 px-1 text-[0.6875rem] font-bold text-primary">{pushMessage}</p>}
    {toast&&<div role="status" aria-live="polite" className="fixed inset-x-4 top-4 z-50 mx-auto max-w-[430px] rounded-2xl bg-ink px-4 py-3 text-[0.8125rem] font-bold text-white shadow-xl">{toast}</div>}
  </>;
}
