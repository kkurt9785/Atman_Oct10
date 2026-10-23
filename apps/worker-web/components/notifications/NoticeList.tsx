'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BackButton } from '@/components/BackButton';
import { noticeHref, type Notice } from '@/lib/notification-scope';
import { loadScopedNoticePage, type NoticeCursor } from '@/lib/notification-pages';
import { loadWorkerShellContext, type WorkerShell } from '@/lib/worker-mode';

// 알림함 목록. 계정 단위 알림(get_my_notifications)을 셸에 맞는 것만 남겨서 보여 준다.
//   medical: 공고·지원·채팅·급여 + 병원·약국 근태·워크룸
//   gig:     긱 근무지의 근태·워크룸만
function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function NoticeList({ shell, eyebrow, title, emptyHint, back }: { shell: WorkerShell; eyebrow: string; title: string; emptyHint: string; back?: { href: string; label: string } }) {
  const [rows, setRows] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<NoticeCursor | null>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);

  const load = useCallback(async (append = false) => {
    if (append && busyRef.current) return;
    const request = ++requestRef.current;
    busyRef.current = true;
    setLoading(true);
    setError('');
    if (!append) { setRows([]); setHasMore(false); cursorRef.current = null; }
    try {
      const context = await loadWorkerShellContext().catch(() => null);
      const result = await loadScopedNoticePage(async cursor => {
        const { data, error: rpcError } = await supabase.rpc('get_my_notifications_page', {
          p_limit: 50, p_before_created_at: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null,
        });
        if (rpcError) throw rpcError;
        return (data ?? []) as Notice[];
      }, context, shell, append ? cursorRef.current : null);
      if (request !== requestRef.current) return;
      cursorRef.current = result.cursor;
      setHasMore(result.hasMore);
      setRows(current => [...new Map([...(append ? current : []), ...result.rows].map(row => [row.id, row])).values()]);
    } catch { if (request === requestRef.current) setError('알림을 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.'); }
    finally { if (request === requestRef.current) { setLoading(false); busyRef.current = false; } }
  }, [shell]);

  useEffect(() => { void load(); return () => { requestRef.current++; busyRef.current = false; }; }, [load]);

  async function openNotice(row: Notice) {
    setError('');
    if (!row.read_at) {
      try {
        const { data, error: readError } = await supabase.rpc('mark_my_notification_read', { p_notification_id: row.id });
        if(readError || data !== true) setError('읽음 표시를 저장하지 못했어요. 알림 내용은 계속 확인할 수 있어요.');
        else setRows((current) => current.map((item) => (item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item)));
      } catch { setError('읽음 표시를 저장하지 못했어요. 연결 상태를 확인해 주세요.'); }
    }
    const href = noticeHref(row.data?.url, shell);
    if (href) window.location.href = href;
  }

  return (
    <main className={`px-5 pb-8 ${back ? 'pt-4' : 'pt-12'}`}>
      {back && <BackButton href={back.href} label={back.label} />}
      <div className="mb-5 mt-1 flex items-end justify-between">
        <div>
          <p className="text-[12px] font-bold text-primary">{eyebrow}</p>
          <h1 className="mt-1 text-[26px] font-extrabold text-ink">{title}</h1>
        </div>
        <button onClick={() => void load()} className="-mr-2 min-h-11 px-2 text-[12px] font-bold text-primary">새로고침</button>
      </div>
      {loading && <p role="status" className="mb-3 text-[13px] text-sub">알림을 확인하고 있어요...</p>}
      {error && (
        <div role="alert" className="mb-3 rounded-2xl border border-danger/20 bg-white p-4">
          <p className="text-[14px] font-bold text-ink">{error}</p>
          <button onClick={() => void load()} className="mt-2 min-h-11 px-2 text-[13px] font-bold text-primary">다시 시도</button>
        </div>
      )}
      {!loading && !error && rows.length === 0 && !hasMore && (
        <div className="rounded-2xl bg-bg py-12 text-center">
          <p className="text-[15px] font-bold text-ink">아직 알림이 없어요</p>
          <p className="mt-1 text-[12px] text-sub">{emptyHint}</p>
        </div>
      )}
      <div className="space-y-2">
        {rows.map((row) => (
          <button key={row.id} onClick={() => void openNotice(row)} className={`w-full rounded-2xl border px-4 py-4 text-left active:bg-bg ${row.read_at ? 'border-line bg-white' : 'border-primary/20 bg-primary/5'}`}>
            <div className="flex items-start gap-3">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${row.read_at ? 'bg-line' : 'bg-primary'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-col items-start gap-1">
                  <p className="break-words text-[15px] font-extrabold text-ink">{row.title}</p>
                  <time dateTime={row.created_at} className="text-[11px] text-tertiary">{formatDate(row.created_at)}</time>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-sub">{row.body}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
      {hasMore && <div className="mt-4 text-center">
        {rows.length === 0 && <p className="mb-2 text-sm text-sub">최근 확인한 알림에는 이 근무 유형의 소식이 없어요. 이전 알림을 더 확인해 보세요.</p>}
        <button type="button" disabled={loading} onClick={() => void load(true)} className="min-h-11 w-full rounded-xl border border-line bg-white px-4 text-sm font-bold text-primary disabled:opacity-50">{loading ? '이전 알림 확인 중…' : '이전 알림 더 보기'}</button>
      </div>}
    </main>
  );
}
