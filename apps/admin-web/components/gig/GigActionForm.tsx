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
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(true); setError(''); setMessage('');
    const data = new FormData(event.currentTarget);
    Object.entries(values ?? {}).forEach(([key, value]) => data.set(key, value));
    const result = await runGigProjectAction(kind, data);
    setLoading(false);
    if (!result.ok) { setError(result.error ?? '처리하지 못했어요.'); return; }
    if (resetOnSuccess) formRef.current?.reset();
    if (successMessage) setMessage(successMessage);
    onSuccess?.(result.data);
    router.refresh();
  }
  return <form ref={formRef} onSubmit={submit} className={className}>
    <fieldset disabled={loading} className="contents disabled:opacity-60">{children}</fieldset>
    {loading && <p className="col-span-full mt-1 text-[12px] font-bold text-primary">처리 중...</p>}
    {error && <p role="alert" className="col-span-full mt-1 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-bold text-red-600">{error}</p>}
    {message && <p role="status" className="col-span-full mt-1 rounded-lg bg-success/10 px-3 py-2 text-[12px] font-bold text-success">{message}</p>}
  </form>;
}
