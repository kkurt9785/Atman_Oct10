import 'server-only';
import { adminClient } from './supabase';
import { platformAdminEmails, platformAdminUserIds } from './platform-admin';
import { nudgeNotificationDispatch } from './notify-nudge';
import { todayKST } from './date';
import { probeBusinessStatus, serviceKeyShape, BUSINESS_STATUS_LABEL } from './nts';

// 국세청 조회 점검용 번호 — 잇닿(케셰르) 자기 사업자등록번호(사이트 하단에 공개). 키가 살아 있으면 '계속사업자'가 나와야 한다.
const NTS_PROBE_BRN = process.env.NTS_PROBE_BRN ?? '4814401177';

// 직업안정법 §25(2026-12-10) 운영 의무 3가지를 매일 점검한다: 국세청 조회 동작 · 공고 신고 처리 · 공표 정보 월 1회 대조
async function complianceChecks(sb: NonNullable<ReturnType<typeof adminClient>>): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  if (!process.env.NTS_BUSINESS_API_KEY) {
    out.push({ key: 'nts', label: '국세청 사업자 조회', level: 'error', count: null, detail: 'NTS_BUSINESS_API_KEY 미설정 · 휴·폐업 사업장 자동 차단이 멈춰 있어요' });
  } else {
    const probe = await probeBusinessStatus(NTS_PROBE_BRN);
    out.push(!probe.ok
      ? (() => { const shape = serviceKeyShape(process.env.NTS_BUSINESS_API_KEY); const shapeNote = shape.length === 88 && shape.base64 ? '키 형태 정상(88자)' : `키 형태 이상(${shape.length}자${shape.base64 ? '' : '·허용 외 문자'}) — 포털 키를 다시 복사해 넣어 주세요`;
          return { key: 'nts', label: '국세청 사업자 조회', level: 'error' as const, count: null, detail: `조회 실패 · ${probe.reason} · ${shapeNote}${probe.reason.includes('코드 -4') && shape.length === 88 && shape.base64 ? ' · 발급 직후 활성 대기일 가능성이 커요' : ''}` }; })()
      : probe.result.status === 'active'
        ? { key: 'nts', label: '국세청 사업자 조회', level: 'ok', count: null, detail: `점검용 번호 ${BUSINESS_STATUS_LABEL.active}` }
        : { key: 'nts', label: '국세청 사업자 조회', level: 'warn', count: null, detail: `조회는 되지만 점검용 번호가 ${BUSINESS_STATUS_LABEL[probe.result.status] ?? probe.result.status}` });
  }
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 35 * 86_400_000).toISOString();
  const [postings, staleFlags] = await Promise.all([
    sb.from('job_posting_reports').select('id', { count: 'exact', head: true }).in('status', ['open', 'reviewing']).lt('created_at', twoDaysAgo),
    sb.from('facilities').select('id', { count: 'exact', head: true }).eq('is_demo', false).eq('is_active', true).is('deleted_at', null)
      .or(`public_flags_checked_at.is.null,public_flags_checked_at.lt.${monthAgo}`),
  ]);
  out.push({ key: 'posting-reports', label: '공고·사업장 신고 검토', level: postings.error ? 'error' : (postings.count ?? 0) > 0 ? 'error' : 'ok', count: postings.count,
    detail: postings.error ? '신고 목록 조회 실패' : (postings.count ?? 0) > 0 ? '접수 후 48시간이 지난 미처리 신고 · 신고 검토에서 확인' : null });
  out.push({ key: 'public-flags', label: '체불·산재 공표 대조', level: staleFlags.error ? 'warn' : (staleFlags.count ?? 0) > 0 ? 'warn' : 'ok', count: staleFlags.count,
    detail: staleFlags.error ? '대조 현황 조회 실패' : (staleFlags.count ?? 0) > 0 ? '35일 넘게 대조하지 않은 운영 사업장 · 등록 심사 › 구인자 공표 정보' : null });
  return out;
}

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
  const [cleanup, reports] = await Promise.all([
    sb.rpc('account_storage_cleanup_health'),
    sb.from('chat_safety_reports').select('id', {count:'exact',head:true}).in('status',['open','reviewing']).lt('created_at',new Date(Date.now()-24*60*60*1000).toISOString()),
  ]);
  const cleanupReady = !cleanup.error && cleanup.data?.configured === true && cleanup.data?.scheduled === true;
  const overdue = Number(cleanup.data?.overdue ?? 0);
  checks.push({key:'withdrawal-storage',label:'탈퇴 파일 삭제',level:!cleanupReady||overdue>0?'error':'ok',count:overdue,
    detail:!cleanupReady?'자동 삭제 설정·스케줄 확인 필요':overdue>0?'15분 이상 처리되지 않은 삭제 작업이 있어요':null});
  checks.push({key:'safety-reports',label:'대화 신고 검토',level:reports.error?'error':(reports.count??0)>0?'error':'ok',count:reports.count,
    detail:reports.error?'신고 목록 조회 실패':(reports.count??0)>0?'접수 후 24시간이 지난 미처리 신고 · 운영 관리에서 확인':null});
  checks.push(...await complianceChecks(sb));
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
