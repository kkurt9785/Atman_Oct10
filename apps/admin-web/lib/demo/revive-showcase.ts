// 데모 쇼케이스 되살리기 — scripts/revive_demo.py 를 서버 런타임용으로 이식.
//
// 원본은 검증된 파이썬 스크립트(시연 전날 수동 실행)였다. supabase-js 로 바꾸면
// GoTrue admin 이메일 조회 등에서 버전별 동작차가 생길 수 있어, 데모 신뢰성을 위해
// 원본의 REST/GoTrue 호출을 그대로 raw fetch 로 1:1 이식한다.
//
// 사용처:
//  - app/api/cron/expire-shifts  (매일 KST 08:30, 자동 재시드)
//  - app/api/cron/revive-demo    (수동 온디맨드 재시드)
//
// 전제: 데모 병원 50개(business_registration_number=DEMO-TARGET-*)와
//       데모 워커 95명(kakao_id=kakao_demo_*)은 DB에 이미 존재.

import { todayKST } from '@/lib/date';

type Worker = { id: string; kakao_id: string; role: string };
type Facility = { id: string; name?: string; business_registration_number: string; facility_type: string };

export type ReviveSummary = {
  ok: boolean;
  as_of: string;
  super_accounts: number;
  facility_access_rows: number;
  purged_shifts: number;
  matched: { shifts: number; applications: number; attendances_status: number };
  open: { shifts: number; applications: number };
  covers: number;
  workforce: { clinic: unknown; pharmacy: unknown; demo1_application: unknown };
  totals: { matched_today: number; open_today: number };
};

const SUPER_ACCOUNTS: Array<[email: string, name: string, accessRole: string]> = [
  ['sales-demo-1@demo.atman.co.kr', '시연 슈퍼계정 1', 'super'],
  ['sales-demo-2@demo.atman.co.kr', '약국 시연 관리자', 'super'],
  ['sales-demo-3@demo.atman.co.kr', '요양병원 시연 관리자', 'super'],
];
function demoPassword() {
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!password || password.length < 24) throw new Error('DEMO_ACCOUNT_PASSWORD not configured');
  return password;
}

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
      password: demoPassword(),
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
      password: demoPassword(),
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

  // ── 3. facility_admin_access (계정별 대표 사업장 1곳) ───────────────────────
  // 약국은 직군·시급·근태 시드 구조가 달라 아래 병원 50개 생성 루프에서 제외하고
  // refresh_demo_pharmacy_workforce()로 별도 갱신한다.
  const fac = await req<Facility[]>(
    'GET',
    '/rest/v1/facilities?business_registration_number=like.DEMO-TARGET-*&facility_type=neq.pharmacy&select=id,name,business_registration_number,facility_type&order=business_registration_number',
  );
  if (fac.status !== 200 || !Array.isArray(fac.data)) {
    throw new Error(`facilities load failed: ${fac.status}`);
  }
  const facilities = fac.data;
  const pharmacy=await req<Facility[]>('GET','/rest/v1/facilities?business_registration_number=eq.DEMO-TARGET-PHARMACY&select=id,name,business_registration_number,facility_type');
  const gigworker=await req<Facility[]>('GET','/rest/v1/facilities?business_registration_number=eq.DEMO-GIGWORKER-2026&select=id,name,business_registration_number,facility_type');
  const demoTargets:Record<string,Facility|undefined>={
    'sales-demo-1@demo.atman.co.kr':facilities.find(f=>f.name==='W여성병원'),
    'sales-demo-2@demo.atman.co.kr':pharmacy.data?.[0],
    'sales-demo-3@demo.atman.co.kr':facilities.find(f=>f.business_registration_number==='DEMO-TARGET-0026'&&f.facility_type==='care_hospital'),
  };
  const accessRows=SUPER_ACCOUNTS.map(([email])=>{
    const target=demoTargets[email];
    if(!target)throw new Error(`demo target missing for ${email}`);
    return {user_id:adminIds[email],facility_id:target.id,access_role:'super',can_view_payroll:true};
  });
  const gigworkerTarget=gigworker.data?.[0];
  if(!gigworkerTarget)throw new Error('gigworker demo target missing');
  // sales-demo-1은 병원 시연과 긱 시연을 모두 전환해 보여 준다. 재시드가 기존 권한을 전부 지우므로
  // 긱 접근도 같은 배치에 넣지 않으면 매일 다시 사라진다.
  accessRows.push({user_id:adminIds['sales-demo-1@demo.atman.co.kr'],facility_id:gigworkerTarget.id,access_role:'super',can_view_payroll:true});
  await req('DELETE',`/rest/v1/facility_admin_access?user_id=in.(${Object.values(adminIds).join(',')})`);
  await req(
    'POST',
    '/rest/v1/facility_admin_access?on_conflict=user_id,facility_id',
    accessRows,
    'resolution=merge-duplicates',
  );

  // 시연 사업장은 최상위 플랜 상시 활성(이번 달 말일까지로 굴림). 공고·초대 사용량은 매일 비워
  // 여러 영업 담당이 같은 계정으로 시연해도 월 한도에 걸리지 않게 한다.
  const demoPlans = await req('POST', '/rest/v1/rpc/ensure_demo_subscriptions', {});
  if (demoPlans.status !== 200) {
    throw new Error(`demo subscriptions refresh failed: ${demoPlans.status} ${JSON.stringify(demoPlans.data)}`);
  }
  const entryFacilityIds = [...accessRows.map((r) => r.facility_id), gigworkerTarget.id];
  await req('DELETE', `/rest/v1/service_usage_events?facility_id=in.(${entryFacilityIds.join(',')})`);

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
      description: '시연용 오늘 확정 근무예요. 데모 워커가 배정되어 관리자 홈에 보여요.',
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
      description: '시연용 오늘 모집 공고예요. 데모 워커 지원자가 관리자 지원 현황에 보여요.',
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

  // ── 8. 병원·약국 근태와 demo-1 지원을 순서대로 재생성 (RPC) ─────────────────
  const clinicWorkforce = await req('POST', '/rest/v1/rpc/refresh_demo_clinic_workforce', {});
  if (clinicWorkforce.status !== 200) {
    throw new Error(`clinic workforce refresh failed: ${clinicWorkforce.status} ${JSON.stringify(clinicWorkforce.data)}`);
  }
  const pharmacyWorkforce = await req('POST', '/rest/v1/rpc/refresh_demo_pharmacy_workforce', {});
  if (pharmacyWorkforce.status !== 200) {
    throw new Error(`pharmacy workforce refresh failed: ${pharmacyWorkforce.status} ${JSON.stringify(pharmacyWorkforce.data)}`);
  }
  // 직원 refresh는 데모 직원을 재생성하므로 FK cascade로 과거 근태도 함께
  // 지워진다. 영상/시연에서 월간 이력이 항상 유지되도록 직원 생성 직후 복원한다.
  const anchorMonth = await req('POST', '/rest/v1/rpc/refresh_anchor_demo_month_history', {});
  if (anchorMonth.status !== 200) {
    throw new Error(`anchor month history refresh failed: ${anchorMonth.status} ${JSON.stringify(anchorMonth.data)}`);
  }
  const careMonth = await req('POST', '/rest/v1/rpc/refresh_demo_care_month_history', {});
  if (careMonth.status !== 200) {
    throw new Error(`care month history refresh failed: ${careMonth.status} ${JSON.stringify(careMonth.data)}`);
  }
  // 쇼케이스 open 공고 생성이 끝난 뒤 실행해야 demo-1 지원이 항상 살아난다.
  const demo1Application = await req('POST', '/rest/v1/rpc/ensure_demo1_wf_application', {});
  if (demo1Application.status !== 200) {
    throw new Error(`demo1 application refresh failed: ${demo1Application.status} ${JSON.stringify(demo1Application.data)}`);
  }

  // ── 9. 대타 요청 (병원 시연 2곳) — 내일 확정 근무 + 다른 워커가 맡겠다고 한 상태 ──
  // 관리자 홈 '대타 승인'과 모집 탭 상단 카드에서 바로 승인·거절을 시연한다. 약국은 약사가 1명이라 제외.
  // 근무 notes 가 DEMO-SHOWCASE-* 라 다음 재시드의 4단계 청소에서 대타 요청까지 함께 지워진다.
  const TOMORROW = todayKST(new Date(now + 24 * HOUR));
  const coverTargets = [demoTargets['sales-demo-1@demo.atman.co.kr'], demoTargets['sales-demo-3@demo.atman.co.kr']];
  const rnWorkers = byRole.rn;
  let covers = 0;
  for (const [i, f] of coverTargets.entries()) {
    if (!f || rnWorkers.length < 4) continue;
    // 오늘 쇼케이스 배정과 겹치지 않도록 목록 끝쪽 워커를 쓴다 (내일 09~18시는 오늘 야간 07시 종료와도 안 겹침)
    const requester = rnWorkers[rnWorkers.length - 1 - i * 2];
    const claimer = rnWorkers[rnWorkers.length - 2 - i * 2];
    const shift = await req<Array<{ id: string }>>('POST', '/rest/v1/shifts', {
      facility_id: f.id,
      required_role: 'rn',
      shift_date: TOMORROW,
      start_time: '09:00',
      end_time: '18:00',
      hourly_wage: 17000,
      estimated_total_pay: 17000 * 8,
      description: '시연용 대타 요청 근무예요. 확정 근무자가 대타를 요청했고 인력풀 근무자가 맡겠다고 했어요.',
      department: f.facility_type === 'care_hospital' ? '요양병동' : '일반병동',
      notes: `DEMO-SHOWCASE-COVER-${String(i + 1).padStart(4, '0')}`,
      status: 'matched',
      matched_worker_id: requester.id,
      matched_at: iso(26 * HOUR),
    }, 'return=representation');
    const shiftId = shift.data?.[0]?.id;
    if (shift.status !== 201 || !shiftId) throw new Error(`cover shift insert failed: ${shift.status} ${JSON.stringify(shift.data)}`);
    const app = await req<Array<{ id: string }>>('POST', '/rest/v1/shift_applications', {
      shift_id: shiftId,
      worker_id: requester.id,
      status: 'accepted',
      match_score: 93,
      distance_meters: 1400,
      applied_at: iso(28 * HOUR),
      responded_at: iso(26 * HOUR),
    }, 'return=representation');
    const appId = app.data?.[0]?.id;
    if (app.status !== 201 || !appId) throw new Error(`cover application insert failed: ${app.status} ${JSON.stringify(app.data)}`);
    // 대타는 인력풀(함께 일해 본 사람)만 맡을 수 있다
    await req('POST', '/rest/v1/facility_worker_pool?on_conflict=facility_id,worker_id', {
      facility_id: f.id,
      worker_id: claimer.id,
      status: 'active',
      source: 'completed_shift',
      first_worked_at: '2026-08-01',
      last_worked_at: todayKST(new Date(now - 7 * 24 * HOUR)),
      completed_shift_count: 4,
    }, 'resolution=merge-duplicates');
    const cover = await req('POST', '/rest/v1/shift_cover_requests', {
      shift_id: shiftId,
      facility_id: f.id,
      requester_application_id: appId,
      requester_worker_id: requester.id,
      reason: '가족 행사가 갑자기 잡혔어요',
      status: 'claimed',
      claimer_worker_id: claimer.id,
      claimed_at: iso(40 * MIN),
      created_at: iso(3 * HOUR),
    });
    if (cover.status !== 201) throw new Error(`cover request insert failed: ${cover.status} ${JSON.stringify(cover.data)}`);
    covers += 1;
  }

  // ── 10. 오늘 데이터 집계 ────────────────────────────────────────────────────
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
    covers,
    workforce: {
      clinic: clinicWorkforce.data,
      pharmacy: pharmacyWorkforce.data,
      demo1_application: demo1Application.data,
    },
    totals: {
      matched_today: (matchedCount.data ?? []).length,
      open_today: (openCount.data ?? []).length,
    },
  };
}
