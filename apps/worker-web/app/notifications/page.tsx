'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Notice = { id: string; event_type: string; title: string; body: string; data: Record<string, unknown> | null; created_at: string; read_at: string | null };
function formatDate(value: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }

export default function NotificationsPage() {
  const [rows, setRows] = useState<Notice[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); const { data, error: rpcError } = await supabase.rpc('get_my_notifications', { p_limit: 50 }); if (rpcError) setError('알림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); else setRows((data ?? []) as Notice[]); setLoading(false); }, []);
  useEffect(() => { void load(); }, [load]);
  async function openNotice(row: Notice) { if (!row.read_at) { await supabase.rpc('mark_my_notification_read', { p_notification_id: row.id }); setRows((current) => current.map((item) => item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item)); } const href = typeof row.data?.url === 'string' ? row.data.url : null; if (href) window.location.href = href; }
  return <main className="px-5 pt-4 pb-8"><div className="mb-5 flex items-end justify-between"><div><p className="text-[12px] font-bold text-primary">놓친 알림도 한곳에서</p><h1 className="mt-1 text-[26px] font-extrabold text-ink">알림</h1></div><button onClick={() => void load()} className="text-[12px] font-bold text-primary">새로고침</button></div>{error && <div className="mb-3 rounded-2xl border border-danger/20 bg-white p-4"><p className="text-[14px] font-bold text-ink">{error}</p><button onClick={() => void load()} className="mt-2 text-[12px] font-bold text-primary">다시 시도</button></div>}{!loading && !error && rows.length === 0 && <div className="rounded-2xl bg-bg py-12 text-center"><p className="text-[15px] font-bold text-ink">아직 알림이 없어요</p><p className="mt-1 text-[12px] text-sub">새 근무·채팅·출퇴근 알림이 여기에 쌓여요.</p></div>}<div className="space-y-2">{rows.map((row) => <button key={row.id} onClick={() => void openNotice(row)} className={`w-full rounded-2xl border px-4 py-4 text-left active:bg-bg ${row.read_at ? 'border-line bg-white' : 'border-primary/20 bg-primary/5'}`}><div className="flex items-start gap-3"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${row.read_at ? 'bg-line' : 'bg-primary'}`} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-[15px] font-extrabold text-ink">{row.title}</p><time className="shrink-0 text-[11px] text-tertiary">{formatDate(row.created_at)}</time></div><p className="mt-1 text-[13px] leading-relaxed text-sub">{row.body}</p></div></div></button>)}</div></main>;
}
