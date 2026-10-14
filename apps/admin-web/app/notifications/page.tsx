'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { Card } from '@/components/ui';
import { safeNotificationPath } from '../../lib/shared/notifications/navigation';

type Notice = { id: string; event_type: string; title: string; body: string; data: Record<string, unknown> | null; created_at: string; read_at: string | null };

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function NotificationsPage() {
  const [rows, setRows] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
    const { data, error: rpcError } = await supabase.rpc('get_my_notifications', { p_limit: 50 });
    if (rpcError) setError('알림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    else setRows((data ?? []) as Notice[]);
    } catch { setError('알림을 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function openNotice(row: Notice) {
    setError('');
    if (!row.read_at) {
      try {
        const {data,error:readError}=await supabase.rpc('mark_my_notification_read', { p_notification_id: row.id });
        if(readError||data!==true)setError('읽음 표시를 저장하지 못했어요. 알림 내용은 계속 확인할 수 있어요.');
        else setRows((current) => current.map((item) => item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item));
      } catch { setError('읽음 표시를 저장하지 못했어요. 연결 상태를 확인해 주세요.'); }
    }
    const href = safeNotificationPath(row.data?.url);
    if (href) window.location.href = href;
  }
  return <main className="px-4">
    <div className="mt-3 mb-4 flex items-end justify-between px-1"><div><p className="text-label font-bold text-primary">놓친 알림도 한곳에서</p><h1 className="text-display font-extrabold text-ink mt-1">알림</h1></div><button onClick={() => void load()} className="min-h-11 px-2 text-label font-bold text-primary">새로고침</button></div>
    {loading&&<p role="status" className="mb-3 text-label text-sub">알림을 확인하고 있어요...</p>}
    {error && <Card className="mb-3 border border-red-200"><p role="alert" className="text-body font-bold text-ink">{error}</p><button onClick={() => void load()} className="mt-2 min-h-11 px-2 text-label font-bold text-primary">다시 시도</button></Card>}
    {!loading && !error && rows.length === 0 && <Card className="py-12 text-center"><p className="text-body font-bold text-ink">아직 알림이 없어요</p><p className="mt-1 text-label text-sub">새 지원·채팅·출퇴근 알림이 여기에 쌓여요.</p></Card>}
    <div className="space-y-2">{rows.map((row) => <button key={row.id} onClick={() => void openNotice(row)} className={`w-full rounded-2xl border px-4 py-4 text-left active:bg-bg ${row.read_at ? 'border-line bg-white' : 'border-primary/20 bg-primary/5'}`}><div className="flex items-start gap-3"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${row.read_at ? 'bg-line' : 'bg-primary'}`} /><div className="min-w-0 flex-1"><div className="flex flex-col items-start gap-1"><p className="break-words text-body font-extrabold text-ink">{row.title}</p><time dateTime={row.created_at} className="text-[0.6875rem] text-tertiary">{formatDate(row.created_at)}</time></div><p className="mt-1 text-label leading-relaxed text-sub">{row.body}</p></div></div></button>)}</div>
  </main>;
}
