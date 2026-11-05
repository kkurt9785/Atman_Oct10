'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { runGigProjectAction, type GigProjectActionKind } from '@/lib/actions/gig-projects';

// 근무 건 액션용 폼. WorkforceActionForm 과 같은 모양이되 runGigProjectAction 을 부른다.
export function GigActionForm({ kind, values, className, children, resetOnSuccess = false, successMessage, confirmText, onSuccess }: {
  kind: GigProjectActionKind; values?: Record<string, string>; className?: string; children: React.ReactNode;
  resetOnSuccess?: boolean; successMessage?: string; confirmText?: string; onSuccess?: (data: unknown) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // 액션이 성공했지만 사장님이 알아야 할 것(예: 출근 가능 시간을 못 맞춘 근무자)을 data.notice 로 돌려준다
  const [notice, setNotice] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(true); setError(''); setMessage(''); setNotice('');
    const data = new FormData(event.currentTarget);
    Object.entries(values ?? {}).forEach(([key, value]) => data.set(key, value));
    const result = await runGigProjectAction(kind, data);
    setLoading(false);
    if (!result.ok) { setError(result.error ?? '처리하지 못했어요.'); return; }
    if (resetOnSuccess) formRef.current?.reset();
    if (successMessage) setMessage(successMessage);
    const note = (result.data as { notice?: unknown } | null | undefined)?.notice;
    if (typeof note === 'string' && note) setNotice(note);
    onSuccess?.(result.data);
    router.refresh();
  }
  return <form ref={formRef} onSubmit={submit} className={className}>
    <fieldset disabled={loading} className="contents disabled:opacity-60">{children}</fieldset>
    {loading && <p className="col-span-full mt-1 text-[0.75rem] font-bold text-primary">처리 중...</p>}
    {error && <p role="alert" className="col-span-full mt-1 rounded-lg bg-red-50 px-3 py-2 text-[0.75rem] font-bold text-red-600">{error}</p>}
    {message && <p role="status" className="col-span-full mt-1 rounded-lg bg-success/10 px-3 py-2 text-[0.75rem] font-bold text-success">{message}</p>}
    {notice && <p role="status" className="col-span-full mt-1 rounded-lg bg-amber-50 px-3 py-2 text-[0.75rem] font-bold leading-5 text-amber-800">{notice}</p>}
  </form>;
}
