'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Block = { blocked_user_id: string; peer_label: string; created_at: string };

export function BlockSettings() {
  const [rows, setRows] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error: failure } = await supabase.from('user_safety_blocks').select('blocked_user_id,peer_label,created_at').order('created_at', { ascending: false });
      if (failure || (data?.length ?? 0) >= 1000) throw new Error('차단 목록을 모두 불러오지 못했어요. 다시 시도해 주세요.');
      setRows((data ?? []) as Block[]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '차단 목록을 확인하지 못했어요.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function unblock(row: Block) {
    if (pending.current) return;
    pending.current = true; setBusy(row.blocked_user_id); setError(''); setNotice('');
    try {
      const { data, error: failure } = await supabase.rpc('set_safety_user_block', { p_peer: row.blocked_user_id, p_blocked: false, p_label: row.peer_label });
      if (failure) throw new Error(failure.message);
      if (data !== true) throw new Error('차단 해제 결과를 확인하지 못했어요.');
      setRows(current => current.filter(item => item.blocked_user_id !== row.blocked_user_id));
      setNotice(`${row.peer_label}님의 차단을 해제했어요.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '차단을 해제하지 못했어요.'); }
    finally { pending.current = false; setBusy(null); }
  }

  return <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
    <h2 className="text-[18px] font-extrabold text-ink">차단한 사용자</h2>
    <p className="mt-2 text-[14px] leading-6 text-sub">차단한 사용자의 대화와 채팅 알림은 표시하지 않아요. 근무·근태·급여 기록은 계속 확인할 수 있어요.</p>
    {notice && <p role="status" className="mt-3 text-[14px] font-bold text-primary">{notice}</p>}
    {error ? <div role="alert" className="mt-4"><p className="text-[14px] text-red-600">{error}</p><button type="button" disabled={busy !== null} onClick={() => void load()} className="mt-2 min-h-11 rounded-xl bg-bg px-4 text-[14px] font-bold">다시 불러오기</button></div>
      : loading ? <p role="status" className="mt-4 text-[14px] text-sub">차단 목록을 불러오고 있어요…</p>
      : rows.length === 0 ? <p className="mt-4 text-[14px] text-sub">차단한 사용자가 없어요.</p>
      : <ul className="mt-3 divide-y divide-line">{rows.map(row => <li key={row.blocked_user_id} className="flex items-center justify-between gap-3 py-3">
        <div className="min-w-0"><p className="break-words text-[15px] font-bold text-ink">{row.peer_label}</p><p className="mt-1 text-[12px] text-sub">{new Date(row.created_at).toLocaleDateString('ko-KR')}</p></div>
        <button type="button" disabled={busy !== null} onClick={() => void unblock(row)} className="min-h-11 shrink-0 rounded-xl border border-line px-3 text-[14px] font-bold disabled:opacity-50">{busy === row.blocked_user_id ? '처리 중…' : '차단 해제'}</button>
      </li>)}</ul>}
  </section>;
}
