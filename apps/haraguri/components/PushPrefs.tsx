'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { currentSubscription } from '../lib/push';

// Per-device notification choices, stored on this device's subscription row.
type Prefs = { messages: boolean; files: boolean; daily: boolean; eve: boolean; ingest: boolean; unread: boolean };
const LABELS: [keyof Prefs, string][] = [['messages', '새 메시지'], ['files', '새 사진·문서'], ['unread', '안 읽은 메시지 리마인드 (2시간 뒤 한 번 더)'], ['daily', '아침 8시 오늘 할 일'], ['eve', '저녁 8시 내일 미리 보기'], ['ingest', '가계부 자동 등록 확인']];
const defaults: Prefs = { messages: true, files: true, daily: true, eve: true, ingest: true, unread: true };

export function PushPrefs({ busy, onError }: { busy: boolean; onError: (m: string) => void }) {
  const [endpoint, setEndpoint] = useState('');
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [quiet, setQuiet] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    currentSubscription().then(async sub => {
      if (!sub || !supabase) return;
      const r = await supabase.from('hg_push_subscriptions').select('prefs,quiet_start,quiet_end').eq('endpoint', sub.endpoint).maybeSingle();
      if (!active || !r.data) return;
      setEndpoint(sub.endpoint); setPrefs({ ...defaults, ...(r.data.prefs as Partial<Prefs>) }); setQuiet({ start: r.data.quiet_start, end: r.data.quiet_end });
    });
    return () => { active = false; };
  }, []);
  async function save(next: Prefs, q = quiet) {
    if (!supabase || !endpoint) return;
    setSaving(true);
    const r = await supabase.from('hg_push_subscriptions').update({ prefs: next, quiet_start: q.start, quiet_end: q.end }).eq('endpoint', endpoint);
    setSaving(false);
    if (r.error) onError('알림 설정을 저장하지 못했어요. 다시 시도해 주세요.');
  }
  if (!endpoint) return null;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return <div className="push-prefs">
    <p className="muted">이 기기에서 받을 알림을 고르세요. 기기마다 따로 저장돼요.</p>
    <div className="pref-list">{LABELS.map(([key, label]) => <label key={key} className="pref-row"><input type="checkbox" checked={prefs[key]} disabled={busy || saving} onChange={e => { const next = { ...prefs, [key]: e.target.checked }; setPrefs(next); save(next); }}/>{label}</label>)}</div>
    <div className="quiet-hours"><span>조용한 시간</span>
      <select aria-label="조용한 시간 시작" value={quiet.start ?? ''} disabled={busy || saving} onChange={e => { const q = { ...quiet, start: e.target.value === '' ? null : Number(e.target.value) }; setQuiet(q); save(prefs, q); }}><option value="">끔</option>{hours.map(h => <option key={h} value={h}>{h}시부터</option>)}</select>
      <select aria-label="조용한 시간 끝" value={quiet.end ?? ''} disabled={busy || saving || quiet.start == null} onChange={e => { const q = { ...quiet, end: e.target.value === '' ? null : Number(e.target.value) }; setQuiet(q); save(prefs, q); }}><option value="">—</option>{hours.map(h => <option key={h} value={h}>{h}시까지</option>)}</select>
    </div>
    <small className="muted">조용한 시간에는 이 기기로 푸시를 보내지 않아요. 앱 안의 알림 모음에는 그대로 남아요.</small>
  </div>;
}
