import 'server-only';
import { adminClient } from './supabase';
import { platformAdminEmails, platformAdminUserIds } from './platform-admin';
import { nudgeNotificationDispatch } from './notify-nudge';
import { todayKST } from './date';

// 매일 자동 점검: DB 점검(ops_health_report) + 사이트 응답 확인 → 결과 저장 → 오류가 있으면 운영자에게 푸시.
// 주의(warn)는 운영자 화면 카드에만 남기고 알림은 보내지 않는다 — 매일 울리면 아무도 안 본다.

export type HealthCheck = { key: string; label: string; level: 'ok' | 'warn' | 'error'; count: number | null; detail: string | null };
export type HealthRun = { id?: string; ranAt: string; status: 'ok' | 'warn' | 'error'; checks: HealthCheck[]; trigger: 'cron' | 'manual' };

const WORKER_ORIGIN = process.env.NEXT_PUBLIC_WORKER_WEB_URL ?? 'https://itdot.co.kr';
const ADMIN_ORIGIN = process.env.ADMIN_BASE_URL ?? 'https://admin.itdot.co.kr';
const PAGES: Array<[label: string, url: string]> = [
  ['워커 앱 첫 화면', `${WORKER_ORIGIN}/`],
  ['소개 페이지', `${WORKER_ORIGIN}/intro`],
  ['이용약관', `${WORKER_ORIGIN}/legal/terms`],
  ['관리자 로그인', `${ADMIN_ORIGIN}/login`],
];

async function checkPage(label: string, url: string): Promise<HealthCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const started = Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: controller.signal });
    const ms = Date.now() - started;
    const ok = res.status >= 200 && res.status < 400;
    return { key: `site:${url}`, label: `사이트 · ${label}`, level: ok ? (ms > 5_000 ? 'warn' : 'ok') : 'error', count: res.status, detail: ok ? (ms > 5_000 ? `응답 ${ms}ms` : null) : `HTTP ${res.status}` };
  } catch (error) {
    return { key: `site:${url}`, label: `사이트 · ${label}`, level: 'error', count: null, detail: error instanceof Error && error.name === 'AbortError' ? '10초 안에 응답 없음' : '접속 실패' };
  } finally {
    clearTimeout(timer);
  }
}

async function operatorUserIds(): Promise<string[]> {
  const sb = adminClient();
  const ids = new Set(platformAdminUserIds());
  const emails = platformAdminEmails();
  if (sb && emails.length) {
    const { data } = await sb.auth.admin.listUsers({ perPage: 1000 });
    for (const user of data?.users ?? []) if (user.email && emails.includes(user.email.toLowerCase())) ids.add(user.id);
  }
  return [...ids];
}

export async function runHealthCheck(trigger: 'cron' | 'manual'): Promise<HealthRun> {
  const sb = adminClient();
  if (!sb) throw new Error('DB unavailable');
  const [dbResult, ...pages] = await Promise.all([
    sb.rpc('ops_health_report'),
    ...PAGES.map(([label, url]) => checkPage(label, url)),
  ]);
  const dbChecks: HealthCheck[] = dbResult.error
    ? [{ key: 'db', label: 'DB 점검', level: 'error', count: null, detail: '점검 함수를 실행하지 못했어요' }]
    : ((dbResult.data ?? []) as HealthCheck[]);
  const checks = [...pages, ...dbChecks];
  const status: HealthRun['status'] = checks.some((c) => c.level === 'error') ? 'error' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
  const { data: saved } = await sb.from('ops_health_runs').insert({ status, checks, trigger }).select('id, ran_at').single();

  const errors = checks.filter((c) => c.level === 'error');
  if (errors.length) {
    const recipients = await operatorUserIds();
    if (recipients.length) {
      const today = todayKST();
      await sb.from('notification_outbox').upsert(recipients.map((uid) => ({
        worker_auth_user_id: uid,
        event_type: 'ops.health',
        dedupe_key: `ops.health:${today}:${trigger}:${saved?.id ?? Date.now()}:${uid}`,
        title: `시스템 점검: 문제 ${errors.length}건`,
        body: errors.slice(0, 3).map((c) => `${c.label}${c.count != null ? ` ${c.count}` : ''}`).join(' · '),
        data: { url: '/ops/facilities#health', kind: 'ops.health' },
      })), { onConflict: 'dedupe_key', ignoreDuplicates: true });
      await nudgeNotificationDispatch();
    }
  }
  return { id: saved?.id, ranAt: saved?.ran_at ?? new Date().toISOString(), status, checks, trigger };
}

export async function getLatestHealthRun(): Promise<HealthRun | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data } = await sb.from('ops_health_runs').select('id, ran_at, status, checks, trigger').order('ran_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return { id: data.id, ranAt: data.ran_at, status: data.status, checks: data.checks as HealthCheck[], trigger: data.trigger };
}
