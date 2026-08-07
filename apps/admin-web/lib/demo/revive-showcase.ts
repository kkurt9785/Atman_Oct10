// 데모 쇼케이스 되살리기 — scripts/revive_demo.py 를 서버 런타임용으로 이식.
//
// 원본은 검증된 파이썬 스크립트(시연 전날 수동 실행)였다. supabase-js 로 바꾸면
// GoTrue admin 이메일 조회 등에서 버전별 동작차가 생길 수 있어, 데모 신뢰성을 위해
// 원본의 REST/GoTrue 호출을 그대로 raw fetch 로 1:1 이식한다.
//
// 사용처:
//  - app/api/cron/expire-shifts  (매일 KST 00:00, 자동 재시드)
//  - app/api/cron/revive-demo    (수동 온디맨드 재시드)
//
// 전제: 데모 병원 50개(business_registration_number=DEMO-TARGET-*)와
//       데모 워커 95명(kakao_id=kakao_demo_*)은 DB에 이미 존재.

import { todayKST } from '@/lib/date';

type Worker = { id: string; kakao_id: string; role: string };
type Facility = { id: string; business_registration_number: string; facility_type: string };

export type ReviveSummary = {
  ok: boolean;
  as_of: string;
  super_accounts: number;
  facility_access_rows: number;
  purged_shifts: number;
  matched: { shifts: number; applications: number; attendances_status: number };
  open: { shifts: number; applications: number };
  workforce: unknown;
  totals: { matched_today: number; open_today: number };
};

const SUPER_ACCOUNTS: Array<[email: string, name: string, accessRole: string]> = [
  ['sales-demo-1@demo.atman.co.kr', '시연 슈퍼계정 1', 'super'],
  ['sales-demo-2@demo.atman.co.kr', '시연 슈퍼계정 2', 'sales'],
  ['sales-demo-3@demo.atman.co.kr', '시연 슈퍼계정 3', 'operator'],
];
const PASSWORD = 'Atman-demo-2026!';

function base(): string {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return url.replace(/\/+$/, '');
}

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  prefer?: string,
): Promise<{ status: number; data: T }> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${base()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

// matched/open 시프트의 근무 시간대 — 원본 times() 재현
function times(rn: number, kind: 'matched' | 'open'): [string, string] {
  const m = rn % 3;
  const matched: Record<number, [string, string]> = {
    1: ['07:00', '15:00'],
    2: ['15:00', '23:00'],
    0: ['23:00', '07:00'],
  };
  const open: Record<number, [string, string]> = {
    1: ['15:00', '23:00'],
    2: ['23:00', '07:00'],
    0: ['07:00', '15:00'],
  };
  return (kind === 'matched' ? matched : open)[m];
}

export async function reviveDemoShowcase(): Promise<ReviveSummary> {
  if (!base() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  }

  const now = Date.now();
  const TODAY = todayKST(); // KST 기준 오늘 (shift_date)
  const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  // ── 1. 슈퍼계정 3개 (GoTrue admin) ─────────────────────────────────────────
  const adminIds: Record<string, string> = {};
  for (const [email, name] of SUPER_ACCOUNTS) {
    const created = await req<{ id?: string }>('POST', '/auth/v1/admin/users', {
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { profile_nickname: name },
    });
    if ((created.status === 200 || created.status === 201) && created.data?.id) {
      adminIds[email] = created.data.id;
      continue;
    }
    // 이미 존재 → 조회 후 비번 리셋
    const found = await req<{ users?: Array<{ id: string; email: string }> }>(
      'GET',
      `/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    );
    const user = found.data?.users?.find((u) => u.email === email);
    if (!user) {
      throw new Error(`super account create+lookup failed for ${email}: ${created.status}`);
    }
    adminIds[email] = user.id;
    await req('PUT', `/auth/v1/admin/users/${user.id}`, {
      password: PASSWORD,
      email_confirm: true,
    });
  }

  // ── 2. profiles (admin 역할) ───────────────────────────────────────────────
  await req(
    'POST',
    '/rest/v1/profiles?on_conflict=id',
    Object.values(adminIds).map((id) => ({ id, role: 'admin', onboarding_done: true })),
    'resolution=merge-duplicates',
  );

  // ── 3. facility_admin_access (3계정 × 데모 병원 전체) ───────────────────────
  const fac = await req<Facility[]>(
    'GET',
    '/rest/v1/facilities?business_registration_number=like.DEMO-TARGET-*&select=id,business_registration_number,facility_type&order=business_registration_number',
  );
  if (fac.status !== 200 || !Array.isArray(fac.data)) {
    throw new Error(`facilities load failed: ${fac.status}`);
  }
  const facilities = fac.data;
  const accessRows = SUPER_ACCOUNTS.flatMap(([email, , accessRole]) =>
    facilities.map((f) => ({ user_id: adminIds[email], facility_id: f.id, access_role: accessRole })),
  );
  await req(
    'POST',
    '/rest/v1/facility_admin_access?on_conflict=user_id,facility_id',
    accessRows,
    'resolution=merge-duplicates',
  );

  // ── 4. 기존 데모 시프트 청소 (attendances → applications → shifts 순) ───────
  const old = await req<Array<{ id: string }>>('GET', '/rest/v1/shifts?notes=like.DEMO-SHOWCASE-*&select=id');
  const oldIds = (old.data ?? []).map((s) => s.id);
  if (oldIds.length) {
    const idlist = oldIds.map((i) => `"${i}"`).join(',');
    await req('DELETE', `/rest/v1/shift_attendances?shift_id=in.(${idlist})`);
    await req('DELETE', `/rest/v1/shift_applications?shift_id=in.(${idlist})`);
    await req('DELETE', `/rest/v1/shifts?id=in.(${idlist})`);
  }

  // ── 5. 데모 워커 로드 (kakao_id 순 — seed의 rn 정렬 재현) ────────────────────
  const wk = await req<Worker[]>(
    'GET',
    '/rest/v1/workers?kakao_id=like.kakao_demo_*&select=id,kakao_id,role&order=kakao_id',
  );
  if (wk.status !== 200 || !Array.isArray(wk.data) || wk.data.length === 0) {
    throw new Error(`demo workers load failed: ${wk.status}`);
  }
  const workers = wk.data;
  const workerAt = (idx1: number) => workers[(idx1 - 1) % workers.length];

  // ── 6. 확정(in_progress) 시프트 50 + accepted 지원 + 출근 기록 ──────────────
  const matchedShifts = facilities.map((f, i) => {
    const rn = i + 1;
    const w = workerAt(rn * 2 - 1);
    const [st, et] = times(rn, 'matched');
    const wage = w.role === 'rn' ? 17000 : 14000;
    const dept = f.facility_type === 'general_hospital' || f.facility_type === 'small_hospital' ? '일반병동' : '요양병동';
    return {
      facility_id: f.id,
      required_role: w.role,
      shift_date: TODAY,
      start_time: st,
      end_time: et,
      hourly_wage: wage,
      estimated_total_pay: wage * 8,
      description: '시연용 오늘 확정 근무입니다. 데모 워커가 배정되어 관리자 홈에 표시됩니다.',
      department: dept,
      notes: `DEMO-SHOWCASE-MATCHED-${String(rn).padStart(4, '0')}`,
      status: 'in_progress',
      matched_worker_id: w.id,
      matched_at: iso(30 * MIN),
    };
  });
  const created = await req<Array<{ id: string; matched_worker_id: string }>>(
    'POST',
    '/rest/v1/shifts',
    matchedShifts,
    'return=representation',
  );
  if (created.status !== 201 || !Array.isArray(created.data)) {
    throw new Error(`matched shifts insert failed: ${created.status} ${JSON.stringify(created.data)}`);
  }
  const matchedApps = created.data.map((s) => ({
    shift_id: s.id,
    worker_id: s.matched_worker_id,
    status: 'accepted',
    match_score: 95,
    distance_meters: 900,
    applied_at: iso(2 * HOUR),
    responded_at: iso(45 * MIN),
  }));
  const appRows = await req<Array<{ id: string; shift_id: string; worker_id: string }>>(
    'POST',
    '/rest/v1/shift_applications',
    matchedApps,
    'return=representation',
  );
  if (appRows.status !== 201 || !Array.isArray(appRows.data)) {
    throw new Error(`matched applications insert failed: ${appRows.status} ${JSON.stringify(appRows.data)}`);
  }
  const attendances = appRows.data.map((a) => ({
    shift_id: a.shift_id,
    worker_id: a.worker_id,
    application_id: a.id,
    check_in_at: iso(25 * MIN),
    check_in_method: 'qr',
    check_in_distance_m: 80,
  }));
  const att = await req('POST', '/rest/v1/shift_attendances', attendances);

  // ── 7. 모집(open) 시프트 50 + applied 지원 (시프트당 3명) ────────────────────
  const openShifts: Array<Record<string, unknown>> = [];
  const openWorkers: Array<[number, Worker]> = [];
  facilities.forEach((f, i) => {
    const rn = i + 1;
    const w = workerAt(rn * 2);
    const [st, et] = times(rn, 'open');
    const wage = w.role === 'rn' ? 17500 : 14500;
    const dept = f.facility_type === 'general_hospital' || f.facility_type === 'small_hospital' ? '응급실' : '요양병동';
    openShifts.push({
      facility_id: f.id,
      required_role: w.role,
      shift_date: TODAY,
      start_time: st,
      end_time: et,
      hourly_wage: wage,
      estimated_total_pay: wage * 8,
      description: '시연용 오늘 모집 공고입니다. 데모 워커 지원자가 관리자 지원 현황에 표시됩니다.',
      department: dept,
      notes: `DEMO-SHOWCASE-OPEN-${String(rn).padStart(4, '0')}`,
      status: 'open',
    });
    openWorkers.push([rn, w]);
  });
  const createdOpen = await req<Array<{ id: string; notes: string }>>(
    'POST',
    '/rest/v1/shifts',
    openShifts,
    'return=representation',
  );
  if (createdOpen.status !== 201 || !Array.isArray(createdOpen.data)) {
    throw new Error(`open shifts insert failed: ${createdOpen.status} ${JSON.stringify(createdOpen.data)}`);
  }
  const byNotes = new Map(createdOpen.data.map((s) => [s.notes, s]));

  // 지원자 3명/시프트 — 병원이 '여러 명 중 고르는' 시연 연출.
  // 시프트 직군과 같은 직군 워커만, 시프트당 중복 없이 순환 배정.
  const byRole: Record<string, Worker[]> = {
    rn: workers.filter((w) => w.role === 'rn'),
    na: workers.filter((w) => w.role === 'na'),
  };
  const openApps: Array<Record<string, unknown>> = [];
  for (const [rn, w] of openWorkers) {
    const s = byNotes.get(`DEMO-SHOWCASE-OPEN-${String(rn).padStart(4, '0')}`);
    const pool = byRole[w.role] ?? [];
    if (!s || pool.length === 0) continue;
    const picked = new Set<string>();
    for (let k = 0; k < 5; k++) picked.add(pool[(rn * 3 + k * 7) % pool.length].id);
    const chosen = [...picked].sort().slice(0, 3);
    chosen.forEach((wid, j) => {
      openApps.push({
        shift_id: s.id,
        worker_id: wid,
        status: 'applied',
        match_score: 72 + ((rn * 5 + j * 11) % 27),
        distance_meters: 500 + ((rn * 53 + j * 431) % 7000),
        applied_at: iso(((rn * 3 + j * 17) % 170) * MIN),
      });
    });
  }
  await req('POST', '/rest/v1/shift_applications', openApps);

  // ── 8. 병원 근태관리 데모 직원·휴가·오늘 기록 재생성 (RPC) ───────────────────
  const workforce = await req('POST', '/rest/v1/rpc/refresh_demo_clinic_workforce', {});
  if (workforce.status !== 200) {
    throw new Error(`workforce demo refresh failed: ${workforce.status} ${JSON.stringify(workforce.data)}`);
  }

  // ── 9. 오늘 데이터 집계 ─────────────────────────────────────────────────────
  const matchedCount = await req<Array<{ id: string }>>(
    'GET',
    `/rest/v1/shifts?notes=like.DEMO-SHOWCASE-MATCHED-*&shift_date=eq.${TODAY}&select=id`,
  );
  const openCount = await req<Array<{ id: string }>>(
    'GET',
    `/rest/v1/shifts?notes=like.DEMO-SHOWCASE-OPEN-*&shift_date=eq.${TODAY}&select=id`,
  );

  return {
    ok: true,
    as_of: TODAY,
    super_accounts: Object.keys(adminIds).length,
    facility_access_rows: accessRows.length,
    purged_shifts: oldIds.length,
    matched: { shifts: created.data.length, applications: appRows.data.length, attendances_status: att.status },
    open: { shifts: createdOpen.data.length, applications: openApps.length },
    workforce: workforce.data,
    totals: {
      matched_today: (matchedCount.data ?? []).length,
      open_today: (openCount.data ?? []).length,
    },
  };
}
