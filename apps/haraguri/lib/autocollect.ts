import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { detectDevice, type Device } from './device';
import { isCollectedPayment, parseShortcutRelease, type IngestDelivery, type ShortcutRelease } from './shortcuts';

// Auto-collect (결제 알림 → 가계부) setup state. One hook feeds the money-tab status line,
// the home banner and the setup card so every surface agrees on where the user is.
// Two steps the person actually does: add the shortcut (and flip its automation on, inside the Shortcuts app), then connect.
// There is no "I did it" confirmation stage — tapping 추가 moves on, and the server tells us the rest (pairing ping, first saved payment).
export type Stage = 'install' | 'pair' | 'waiting' | 'collecting' | 'other';
export type Token = { token: string; created_at: string; received: number; last_used_at: string | null };
export type InboxRow = IngestDelivery & { id: string; received_at: string; summary: string };

export function computeStage(i: { device: Device; installed: boolean; paired: boolean; collecting: boolean }): Stage {
  if (i.collecting) return 'collecting';
  if (i.device !== 'iphone-push') return 'other';
  if (i.paired) return 'waiting';
  return i.installed ? 'pair' : 'install';
}

// Deep link into the Shortcuts app's add sheet for an iCloud-shared shortcut (skips the Safari page).
export const shortcutImportURL = (icloudUrl: string) => `shortcuts://import-shortcut?url=${encodeURIComponent(icloudUrl)}`;

export function ago(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function stageLabel(stage: Stage, lastAt: string | null, saved: number): { text: string; off: boolean } {
  switch (stage) {
    case 'collecting': return { text: `수집 중 ✓ · 마지막 ${lastAt ? ago(lastAt) : '-'} · ${saved.toLocaleString('ko-KR')}건 저장`, off: false };
    case 'waiting': return { text: '연결됨 ✓ · 첫 결제 알림 기다리는 중', off: false };
    case 'other': return { text: lastAt ? `마지막 수신 ${ago(lastAt)}` : '설정 전 · 이 기기 방법 보기', off: !lastAt };
    default: return { text: '아직 꺼져 있어요 · 2분이면 켜요', off: true };
  }
}

export function useAutoCollect(familyId: string, userId: string, active: boolean) {
  const [token, setToken] = useState<Token | null>(null);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [setupAt, setSetupAt] = useState<string | null>(null);
  const [release, setRelease] = useState<ShortcutRelease | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [flags, setFlags] = useState({ installed: false, enabled: false, pairedAt: 0 });
  const [device, setDevice] = useState<Device>('iphone-push');
  const [ios, setIos] = useState<string | null>(null);
  const req = useRef(0);
  const key = useCallback((k: string) => `haraguri-collect-${k}-${familyId}`, [familyId]);

  const readFlags = useCallback(() => {
    try { setFlags({ installed: localStorage.getItem(key('installed')) === '1', enabled: localStorage.getItem(key('enabled')) === '1', pairedAt: Number(localStorage.getItem(key('paired')) || 0) }); } catch { /* private mode */ }
  }, [key]);
  const setFlag = useCallback((k: 'installed' | 'enabled' | 'paired', v: boolean) => {
    try { if (v) localStorage.setItem(key(k), k === 'paired' ? String(Date.now()) : '1'); else localStorage.removeItem(key(k)); } catch { /* private mode */ }
    readFlags();
  }, [key, readFlags]);

  const load = useCallback(async () => {
    if (!supabase || !active || !familyId || !userId) return;
    const n = ++req.current;
    const [t, i, s] = await Promise.all([
      supabase.from('hg_ingest_tokens').select('token,created_at,received,last_used_at').eq('family_id', familyId).eq('user_id', userId).maybeSingle(),
      supabase.from('hg_inbox').select('id,received_at,via,app,raw,status,summary').eq('family_id', familyId).eq('user_id', userId).order('received_at', { ascending: false }).limit(30),
      supabase.from('hg_inbox').select('received_at').eq('family_id', familyId).eq('user_id', userId).eq('via', 'ios-notification-setup').eq('status', 'ignored').order('received_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (n !== req.current || t.error || i.error) return;
    setToken((t.data as Token | null) ?? null); setInbox((i.data ?? []) as InboxRow[]); setSetupAt(s.data?.received_at ?? null); setLoaded(true);
  }, [familyId, userId, active]);

  useEffect(() => {
    setLoaded(false); setToken(null); setInbox([]); setSetupAt(null); readFlags();
    const d = detectDevice(navigator.userAgent); setDevice(d.device); setIos(d.ios);
    let alive = true;
    fetch('/haraguri-notifications.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => { if (alive) setRelease(parseShortcutRelease(v)); }).catch(() => {});
    void load();
    return () => { alive = false; };
  }, [familyId, userId, active, load, readFlags]);

  useEffect(() => {
    if (!supabase || !active || !familyId || !userId) return;
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    // Realtime for new deliveries; iOS suspends the socket while Shortcuts is in front, so also refresh on return and every 10 s.
    const channel = supabase.channel(`collect-${familyId}-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'hg_inbox', filter: `user_id=eq.${userId}` }, () => load()).subscribe(status => { if (status === 'SUBSCRIBED') void load(); });
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 10_000);
    return () => { supabase!.removeChannel(channel); clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [familyId, userId, active, load]);

  const since = token ? Date.parse(token.created_at) : Infinity;
  const current = inbox.filter(r => Date.parse(r.received_at) >= since);
  const proof = current.find(r => isCollectedPayment(r, device)) ?? null;
  const paired = !!token && ((!!setupAt && Date.parse(setupAt) >= since) || flags.pairedAt >= since);
  // token.received only counts saved payments (ingest bumps it after insert), so it keeps '수집 중' true even when the last 30 rows are all ignored alerts.
  const stage = computeStage({ device, installed: flags.installed || paired, paired, collecting: !!proof || (token?.received ?? 0) > 0 });
  const lastAt = proof?.received_at ?? token?.last_used_at ?? null;
  return { familyId, userId, loaded, token, inbox, current, proof, release, device, setDevice, ios, stage, paired, pairedAt: setupAt, lastAt, saved: token?.received ?? 0, flags, setFlag, refresh: load };
}
export type AutoCollectState = ReturnType<typeof useAutoCollect>;
