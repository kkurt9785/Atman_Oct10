// 출퇴근 규칙(docs/attendance/DECISIONS.md D1·D3·D4·D6·D7·D8) DB 시험 — Docker 없이 PGlite(메모리 Postgres)로 돈다. 운영·연결 DB 를 쓰지 않는다.
// 실행: npm i --no-save @electric-sql/pglite@0.2.17 && node scripts/qa-attendance-rules-pglite.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = new URL('../supabase/migrations', import.meta.url).pathname;
const base = readFileSync(`${MIG}/20260916160000_early_leave_grace.sql`, 'utf8');
const m = base.match(/CREATE OR REPLACE FUNCTION public\.record_unified_attendance[\s\S]*?\$function\$\s*;/);
if (!m) throw new Error('base function not found');
const migration = readFileSync(`${MIG}/20261113100000_attendance_missing_checkout_and_gps_rules.sql`, 'utf8');

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label, extra); } };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

await db.exec(`
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA cron;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE FUNCTION extensions.digest(t text, a text) RETURNS bytea LANGUAGE sql AS $$ SELECT convert_to(md5(t),'UTF8') $$;
CREATE TABLE cron.job(jobid serial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES(n,s,c) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(id int) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid=id RETURNING true $$;
-- PostGIS 대역: geography = 'lng,lat' 문자열, 거리 = 하버사인(m)
CREATE DOMAIN public.geography AS text;
CREATE FUNCTION public.ST_MakePoint(x float8, y float8) RETURNS text LANGUAGE sql AS $$ SELECT x||','||y $$;
CREATE FUNCTION public.ST_SetSRID(g text, s int) RETURNS text LANGUAGE sql AS $$ SELECT g $$;
CREATE FUNCTION public.ST_Distance(a public.geography, b public.geography) RETURNS float8 LANGUAGE sql AS $$
  SELECT 2*6371008.8*asin(sqrt(
    power(sin(radians(split_part(b,',',2)::float8-split_part(a,',',2)::float8)/2),2)
    + cos(radians(split_part(a,',',2)::float8))*cos(radians(split_part(b,',',2)::float8))
      *power(sin(radians(split_part(b,',',1)::float8-split_part(a,',',1)::float8)/2),2))) $$;

CREATE TABLE public.facilities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, location public.geography, is_demo boolean DEFAULT false);
CREATE TABLE public.workers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid, deleted_at timestamptz);
CREATE TABLE public.facility_staff(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, worker_id uuid, status text DEFAULT 'active',
  default_start_time time, default_end_time time);
CREATE TABLE public.shifts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, shift_date date, start_time time, end_time time,
  is_overnight boolean GENERATED ALWAYS AS (end_time < start_time) STORED, status text, updated_at timestamptz);
CREATE TABLE public.shift_applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid, worker_id uuid, status text,
  checked_in_at timestamptz, checked_out_at timestamptz);
CREATE TABLE public.facility_attendance_settings(facility_id uuid PRIMARY KEY, authentication_mode text DEFAULT 'gps_or_qr',
  gps_radius_meters int DEFAULT 30, max_gps_accuracy_meters int DEFAULT 80, qr_fallback_enabled boolean DEFAULT true,
  check_in_before_minutes int DEFAULT 60, check_in_after_minutes int DEFAULT 60, check_out_before_minutes int DEFAULT 60,
  check_out_after_minutes int DEFAULT 120, late_grace_minutes int DEFAULT 20, early_leave_grace_minutes int DEFAULT 10, allowed_ips text[]);
CREATE TABLE public.facility_attendance_qr_challenges(token_hash text, facility_id uuid, revoked_at timestamptz, expires_at timestamptz);
CREATE TABLE public.staff_attendances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, staff_id uuid, work_date date,
  scheduled_start time, scheduled_end time, check_in_at timestamptz, check_out_at timestamptz, status text DEFAULT 'scheduled',
  checkout_requested_at timestamptz, check_in_location public.geography, check_out_location public.geography, note text,
  check_in_method text, check_out_method text, check_in_distance_m int, check_out_distance_m int, check_in_gps_accuracy_m int,
  check_out_gps_accuracy_m int, check_in_status text, check_out_status text, late_minutes int DEFAULT 0, early_leave_minutes int DEFAULT 0,
  updated_at timestamptz, UNIQUE(staff_id, work_date));
CREATE TABLE public.shift_attendances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shift_id uuid, worker_id uuid, application_id uuid UNIQUE,
  check_in_at timestamptz, check_in_location public.geography, check_in_distance_m int, check_in_method text, check_in_gps_accuracy_m int,
  check_in_status text, late_minutes int DEFAULT 0, check_out_at timestamptz, check_out_location public.geography, check_out_distance_m int,
  check_out_method text, check_out_gps_accuracy_m int, check_out_status text, early_leave_minutes int DEFAULT 0, checkout_requested_at timestamptz,
  updated_at timestamptz);
CREATE TABLE public.attendance_auth_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, worker_id uuid, staff_id uuid,
  application_id uuid, facility_id uuid, staff_attendance_id uuid, shift_attendance_id uuid, target_type text, action text,
  authentication_method text, latitude float8, longitude float8, gps_accuracy_meters int, distance_meters int, qr_token_hash text,
  result text, failure_reason text, detail text, created_at timestamptz DEFAULT now());
`);
await db.exec(m[0]);

// 원본 본문 그대로일 때 판정 (기준선)
const FAC_LAT = 37.5, FAC_LNG = 127.0, M_PER_DEG = 111195.08;
const latAt = (meters) => FAC_LAT + meters / M_PER_DEG;
const fac = (await one(`INSERT INTO public.facilities(name,location) VALUES('의원','${FAC_LNG},${FAC_LAT}') RETURNING id`)).id;
await db.query(`INSERT INTO public.facility_attendance_settings(facility_id,check_in_before_minutes,check_in_after_minutes,authentication_mode)
  VALUES($1, 1440, 1440, 'gps')`, [fac]); // 시간 창은 시험에서 넉넉히, GPS 판정만 본다
const uid = (await one(`SELECT gen_random_uuid() id`)).id;
const worker = (await one(`INSERT INTO public.workers(auth_user_id) VALUES($1) RETURNING id`, [uid])).id;
await db.exec(`SET test.uid = '${uid}'`);

async function checkIn(meters, accuracy) {
  // 매번 다른 직원 행으로 출근해 '이미 출근' 에 막히지 않게 한다
  const staff = (await one(`INSERT INTO public.facility_staff(facility_id,worker_id,default_start_time,default_end_time)
    VALUES($1,$2,'00:00','23:59') RETURNING id`, [fac, worker])).id;
  const r = await one(`SELECT public.record_unified_attendance('staff',$1,'check_in',$2,$3,$4) r`, [staff, latAt(meters), FAC_LNG, accuracy]);
  await db.exec(`DELETE FROM public.attendance_auth_logs`); // 요청 제한 시험과 섞이지 않게
  return r.r;
}

console.log('[기준선: 기존 판정식]');
ok((await checkIn(55, 40)).reason === 'OUT_OF_RANGE', '55m·정확도 40m 는 기존식에선 범위 밖');

// 마이그레이션 적용 (두 번 — 다시 돌려도 안전해야 한다)
await db.exec(migration);
await db.exec(migration);
const def = (await one(`SELECT pg_get_functiondef('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'::regprocedure) d`)).d;
console.log('[마이그레이션]');
ok((def.match(/LEAST\(COALESCE\(v_accuracy,0\),v_setting\.gps_radius_meters,100\)/g) || []).length === 1, 'GPS 패치가 한 번만 들어감(재실행 안전)');
ok((def.match(/RATE_LIMITED/g) || []).length === 1, '요청 제한 패치가 한 번만 들어감');
ok((await one(`SELECT count(*)::int c FROM cron.job WHERE jobname='attendance-missing-checkout-hourly'`)).c === 1, '크론 1개만 등록');

console.log('[② GPS 오차 반영]');
let r = await checkIn(55, 40); ok(r.ok === true, '반경 30m · 55m 거리 · 정확도 40m → 통과 (55−30=25, 빼는 값은 반경까지)', JSON.stringify(r));
r = await checkIn(75, 80); ok(r.reason === 'OUT_OF_RANGE', '반경 30m · 75m · 정확도 80m → 범위 밖 (75−30=45, 휴대폰이 보낸 오차로 반경 2배를 못 넘음)', JSON.stringify(r));
r = await checkIn(29, 80); ok(r.ok === true, '29m · 정확도 80m → 통과');
r = await checkIn(200, 80); ok(r.reason === 'OUT_OF_RANGE', '200m · 정확도 80m → 범위 밖 (200−30=170)', JSON.stringify(r));
r = await checkIn(20, 120); ok(r.reason === 'GPS_ACCURACY_LOW', '정확도 120m(상한 80 초과) → 정확도 낮음 그대로', JSON.stringify(r));
r = await checkIn(20, null); ok(r.reason === 'GPS_ACCURACY_LOW', '정확도 없음 → 정확도 낮음 그대로', JSON.stringify(r));
await db.query(`UPDATE public.facility_attendance_settings SET gps_radius_meters=100, max_gps_accuracy_meters=150 WHERE facility_id=$1`, [fac]);
r = await checkIn(190, 150); ok(r.ok === true, '병원 반경 100m · 190m · 정확도 150m → 통과 (빼는 값은 100m까지)', JSON.stringify(r));
r = await checkIn(210, 150); ok(r.reason === 'OUT_OF_RANGE', '210m · 정확도 150m → 범위 밖 (210−100=110>100, 상한 100m 확인)', JSON.stringify(r));
await db.query(`UPDATE public.facility_attendance_settings SET gps_radius_meters=30, max_gps_accuracy_meters=80 WHERE facility_id=$1`, [fac]);

console.log('[③ 계정당 요청 제한]');
await db.exec(`DELETE FROM public.attendance_auth_logs`);
await db.query(`INSERT INTO public.attendance_auth_logs(user_id,result,created_at) SELECT $1,'FAIL',now()-interval '2 minutes' FROM generate_series(1,20)`, [uid]);
const staffRL = (await one(`INSERT INTO public.facility_staff(facility_id,worker_id,default_start_time,default_end_time) VALUES($1,$2,'00:00','23:59') RETURNING id`, [fac, worker])).id;
r = (await one(`SELECT public.record_unified_attendance('staff',$1,'check_in',$2,$3,$4) r`, [staffRL, latAt(500), FAC_LNG, 30])).r;
ok(r.reason === 'OUT_OF_RANGE', '2분 전 시도 20번은 세지 않음');
await db.query(`INSERT INTO public.attendance_auth_logs(user_id,result) SELECT $1,'FAIL' FROM generate_series(1,8)`, [uid]);
r = (await one(`SELECT public.record_unified_attendance('staff',$1,'check_in',$2,$3,$4) r`, [staffRL, latAt(500), FAC_LNG, 30])).r;
ok(r.reason === 'OUT_OF_RANGE', '1분 안 10번째 시도까지는 판정함');
const before = (await one(`SELECT count(*)::int c FROM public.attendance_auth_logs`)).c;
r = (await one(`SELECT public.record_unified_attendance('staff',$1,'check_in',$2,$3,$4) r`, [staffRL, latAt(10), FAC_LNG, 30])).r;
ok(r.reason === 'RATE_LIMITED' && r.ok === false, '11번째 시도 → RATE_LIMITED', JSON.stringify(r));
ok((await one(`SELECT count(*)::int c FROM public.attendance_auth_logs`)).c === before, '막힌 시도는 인증 기록(=관리자 푸시)에 안 남음');
const other = (await one(`SELECT gen_random_uuid() id`)).id;
await db.query(`INSERT INTO public.workers(auth_user_id) VALUES($1)`, [other]);
await db.exec(`SET test.uid = '${other}'`);
const otherWorker = (await one(`SELECT id FROM public.workers WHERE auth_user_id=$1`, [other])).id;
const staffOther = (await one(`INSERT INTO public.facility_staff(facility_id,worker_id,default_start_time,default_end_time) VALUES($1,$2,'00:00','23:59') RETURNING id`, [fac, otherWorker])).id;
r = (await one(`SELECT public.record_unified_attendance('staff',$1,'check_in',$2,$3,$4) r`, [staffOther, latAt(10), FAC_LNG, 30])).r;
ok(r.ok === true, '같은 사업장 다른 직원(다른 계정)은 막히지 않음 — IP 기준 아님', JSON.stringify(r));
await db.exec(`SET test.uid = '${uid}'`);

console.log('[① 미퇴근 표시]');
await db.exec(`DELETE FROM public.staff_attendances; DELETE FROM public.shift_attendances;`);
const kst = (s) => `${s}+09`;
async function staffRow({ date, start, end, checkIn, checkOut = null, requested = null, status = 'working', fac: f = fac }) {
  const s = (await one(`INSERT INTO public.facility_staff(facility_id,worker_id,default_start_time,default_end_time) VALUES($1,$2,'09:00','18:00') RETURNING id`, [f, worker])).id;
  return (await one(`INSERT INTO public.staff_attendances(facility_id,staff_id,work_date,scheduled_start,scheduled_end,check_in_at,check_out_at,checkout_requested_at,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [f, s, date, start, end, checkIn, checkOut, requested, status])).id;
}
const flagged = async (id) => (await one(`SELECT missing_checkout_at FROM public.staff_attendances WHERE id=$1`, [id])).missing_checkout_at;
const day = await staffRow({ date: '2026-11-02', start: '09:00', end: '18:00', checkIn: kst('2026-11-02 08:55') });
const night = await staffRow({ date: '2026-11-02', start: '22:00', end: '07:00', checkIn: kst('2026-11-02 21:55') });
const pending = await staffRow({ date: '2026-11-02', start: '09:00', end: '18:00', checkIn: kst('2026-11-02 08:55'), requested: kst('2026-11-02 15:00'), status: 'checkout_pending' });
const done = await staffRow({ date: '2026-11-02', start: '09:00', end: '18:00', checkIn: kst('2026-11-02 08:55'), checkOut: kst('2026-11-02 18:01'), status: 'completed' });
const noSched = await staffRow({ date: '2026-11-02', start: null, end: null, checkIn: kst('2026-11-02 09:00') });
const mark = async (at) => (await one(`SELECT public.mark_missing_checkouts_at($1::timestamptz) n`, [kst(at)])).n;

await mark('2026-11-02 19:59');
ok(!(await flagged(day)), '주간 09~18: 퇴근 가능 시간(20:00) 전에는 표시 안 함');
await mark('2026-11-02 20:01');
ok(!!(await flagged(day)), '주간 09~18: 20:01 에 미퇴근 표시');
ok(!(await flagged(night)), '야간 22~07: 다음 날 아침 전에는 표시 안 함 (자정 넘김 처리)');
await mark('2026-11-03 02:59');
ok(!(await flagged(noSched)), '예정 시간 없는 기록: 출근 후 18시간(다음 날 03:00) 전 표시 안 함');
await mark('2026-11-03 08:59');
ok(!(await flagged(night)), '야간: 다음 날 08:59 (07:00+2h 전) 표시 안 함');
await mark('2026-11-03 09:01');
ok(!!(await flagged(night)), '야간: 다음 날 09:01 에 표시');
ok(!!(await flagged(noSched)), '예정 시간 없는 기록: 출근 후 18시간 지나면 표시');
ok(!(await flagged(pending)), '조기 퇴근 승인 대기는 표시 안 함 (따로 보임)');
ok(!(await flagged(done)), '퇴근한 기록은 표시 안 함');
const firstAt = await flagged(day);
ok((await mark('2026-11-05 10:00')) === 0, '다시 돌려도 새로 표시할 것 없음(0건)');
ok(String(await flagged(day)) === String(firstAt), '처음 표시한 시각을 덮어쓰지 않음');

// 사업장별 퇴근 가능 시간 60분
const fac2 = (await one(`INSERT INTO public.facilities(name,location) VALUES('약국','${FAC_LNG},${FAC_LAT}') RETURNING id`)).id;
await db.query(`INSERT INTO public.facility_attendance_settings(facility_id,check_out_after_minutes) VALUES($1,60)`, [fac2]);
const short = await staffRow({ date: '2026-11-04', start: '09:00', end: '18:00', checkIn: kst('2026-11-04 09:00'), fac: fac2 });
await mark('2026-11-04 19:01');
ok(!!(await flagged(short)), '사업장 설정 퇴근 가능 60분이면 19:01 에 표시');

// 서버가 며칠 꺼져 있었어도 다음 실행이 밀린 것을 한 번에 찍는다
const old1 = await staffRow({ date: '2026-10-20', start: '09:00', end: '18:00', checkIn: kst('2026-10-20 09:00') });
const old2 = await staffRow({ date: '2026-10-21', start: '09:00', end: '18:00', checkIn: kst('2026-10-21 09:00') });
ok((await mark('2026-11-06 10:00')) === 2, '밀린 기록 2건 한 번에 표시');
ok(!!(await flagged(old1)) && !!(await flagged(old2)), '열흘 넘은 기록도 표시');

// 공고 근무(야간)
const sh = (await one(`INSERT INTO public.shifts(facility_id,shift_date,start_time,end_time) VALUES($1,'2026-11-02','22:00','06:00') RETURNING id`, [fac])).id;
const app = (await one(`INSERT INTO public.shift_applications(shift_id,worker_id,status) VALUES($1,$2,'accepted') RETURNING id`, [sh, worker])).id;
const sa = (await one(`INSERT INTO public.shift_attendances(shift_id,worker_id,application_id,check_in_at) VALUES($1,$2,$3,$4) RETURNING id`, [sh, worker, app, kst('2026-11-02 21:58')])).id;
const saFlag = async () => (await one(`SELECT missing_checkout_at FROM public.shift_attendances WHERE id=$1`, [sa])).missing_checkout_at;
await mark('2026-11-03 07:59');
ok(!(await saFlag()), '공고 야간 22~06: 다음 날 07:59 (06:00+2h 전) 표시 안 함');
await mark('2026-11-03 08:01');
ok(!!(await saFlag()), '공고 야간: 다음 날 08:01 에 표시');


// ---------------------------------------------------------------------------
// 20261113110000 — 네트워크 IP(D6) · 공고 근무 정정(D7) · 계좌 없을 때 지급 지시(D8)
// ---------------------------------------------------------------------------
const wageFn = readFileSync(`${MIG}/20260710231000_p0_shift_attendance_settlement.sql`, 'utf8')
  .match(/CREATE OR REPLACE FUNCTION public\.calculate_shift_wage_secure\([\s\S]*?\n\$\$;/);
if (!wageFn) throw new Error('calculate_shift_wage_secure not found');
await db.exec(`
ALTER TABLE public.facilities ADD COLUMN is_5plus boolean DEFAULT true;
ALTER TABLE public.shifts ADD COLUMN hourly_wage int DEFAULT 12000, ADD COLUMN is_holiday boolean DEFAULT false;
ALTER TABLE public.shift_attendances ADD COLUMN manual_override_by uuid, ADD COLUMN manual_override_reason text, ADD COLUMN approved_at timestamptz;
CREATE TABLE public.attendance_period_closures(facility_id uuid, period_month date, status text);
CREATE TABLE public.audit_logs(id bigserial, actor_type text, actor_id uuid, action text, entity_type text, entity_id uuid, before_data jsonb, after_data jsonb);
CREATE TABLE public.worker_bank_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), worker_id uuid, bank_name text, account_number_last4 text,
  is_primary boolean DEFAULT true, deleted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.wage_calculations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attendance_id uuid UNIQUE, org_id uuid, worker_id uuid, shift_id uuid,
  rule_version text, worked_minutes int, night_minutes int, overtime_minutes int, break_minutes int, base int, overtime_premium int,
  night_premium int, holiday_premium int, gross int, breakdown jsonb, calculated_at timestamptz);
CREATE TABLE public.wage_payment_instructions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, worker_id uuid, shift_id uuid,
  attendance_id uuid UNIQUE, wage_calculation_id uuid, bank_account_id uuid, gross_amount int, deduction_status text DEFAULT 'unconfirmed',
  income_tax_amount int DEFAULT 0, local_tax_amount int DEFAULT 0, other_deduction_amount int DEFAULT 0, net_amount int, due_date date,
  status text DEFAULT 'draft', bank_name_snapshot text, account_last4_snapshot text, updated_at timestamptz);
CREATE FUNCTION public.can_manage_facility(f uuid, roles text[]) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.admin', true) = 'on' $$;
-- 0724 의 옛 퇴근 트리거(계좌 있을 때만 지급 지시)를 먼저 걸어 두고, 마이그레이션이 바꾸는지 본다
CREATE FUNCTION public.sync_shift_checkout_to_payroll() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_sync_shift_checkout_to_payroll AFTER UPDATE OF check_out_at ON public.shift_attendances
  FOR EACH ROW EXECUTE FUNCTION public.sync_shift_checkout_to_payroll();
`);
await db.exec(wageFn[0]);
const migration2 = readFileSync(`${MIG}/20261113110000_attendance_ip_shift_correction_payroll.sql`, 'utf8');
await db.exec(migration2);
await db.exec(migration2);
const def2 = (await one(`SELECT pg_get_functiondef('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'::regprocedure) d`)).d;
console.log('[③ 네트워크 IP (D6)]');
ok((def2.match(/public\.attendance_client_ip\(\)/g) || []).length === 1 && !def2.includes('x-forwarded-for'), 'IP 판정을 공용 함수로 바꿈(재실행 안전, 맨 앞 값 판정 없음)');
const ipWith = async (headers) => (await one(`SELECT set_config('request.headers', $1, true), public.attendance_client_ip() ip`, [JSON.stringify(headers)])).ip;
ok(await ipWith({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9', 'cf-connecting-ip': '9.9.9.9' }) === '9.9.9.9', '꾸민 X-Forwarded-For 맨 앞 값 대신 cf-connecting-ip');
ok(await ipWith({ 'x-forwarded-for': '1.2.3.4,9.9.9.9' }) === '9.9.9.9', 'cf 헤더가 없으면 X-Forwarded-For 맨 뒤 값');
ok(await ipWith({}) === null, '헤더가 없으면 IP 없음');
await db.query(`UPDATE public.facility_attendance_settings SET authentication_mode='network', allowed_ips=ARRAY['1.2.3.4'] WHERE facility_id=$1`, [fac]);
await db.exec(`DELETE FROM public.attendance_auth_logs`);
const netCheckIn = async (headers) => {
  const st = (await one(`INSERT INTO public.facility_staff(facility_id,worker_id,default_start_time,default_end_time) VALUES($1,$2,'00:00','23:59') RETURNING id`, [fac, worker])).id;
  await db.exec('BEGIN');
  await db.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify(headers)]);
  const res = (await one(`SELECT public.record_unified_attendance('staff',$1,'check_in') r`, [st])).r;
  await db.exec('COMMIT');
  await db.exec(`DELETE FROM public.attendance_auth_logs`);
  return res;
};
r = await netCheckIn({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9', 'cf-connecting-ip': '9.9.9.9' });
ok(r.reason === 'NETWORK_NOT_ALLOWED', '집(9.9.9.9)에서 병원 IP를 X-Forwarded-For 맨 앞에 꾸며도 거부', JSON.stringify(r));
r = await netCheckIn({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '1.2.3.4' });
ok(r.ok === true, '병원 Wi-Fi(1.2.3.4)에서는 통과', JSON.stringify(r));
await db.query(`UPDATE public.facility_attendance_settings SET authentication_mode='gps', allowed_ips=NULL WHERE facility_id=$1`, [fac]);

console.log('[② 계좌 없을 때 지급 지시 (D8)]');
const mkShift = async (date, start, end, wage = 12000) =>
  (await one(`INSERT INTO public.shifts(facility_id,shift_date,start_time,end_time,hourly_wage) VALUES($1,$2,$3,$4,$5) RETURNING id`, [fac, date, start, end, wage])).id;
const w2 = (await one(`INSERT INTO public.workers(auth_user_id) VALUES(gen_random_uuid()) RETURNING id`)).id;
const sh2 = await mkShift('2026-11-10', '09:00', '18:00');
const app2 = (await one(`INSERT INTO public.shift_applications(shift_id,worker_id,status) VALUES($1,$2,'accepted') RETURNING id`, [sh2, w2])).id;
const att2 = (await one(`INSERT INTO public.shift_attendances(shift_id,worker_id,application_id,check_in_at) VALUES($1,$2,$3,$4) RETURNING id`, [sh2, w2, app2, kst('2026-11-10 09:00')])).id;
await db.query(`UPDATE public.shift_attendances SET check_out_at=$2 WHERE id=$1`, [att2, kst('2026-11-10 18:00')]);
let wpi = await one(`SELECT * FROM public.wage_payment_instructions WHERE attendance_id=$1`, [att2]);
ok(!!wpi && wpi.bank_account_id === null && wpi.gross_amount > 0, '계좌 없이 퇴근해도 지급 지시가 생김(계좌 칸은 빈 채)', JSON.stringify(wpi));
ok(wpi.gross_amount === 96000, '09~18 시급 12,000 → 휴게 60분 빼고 8시간 96,000원', String(wpi?.gross_amount));
await db.query(`INSERT INTO public.worker_bank_accounts(worker_id,bank_name,account_number_last4) VALUES($1,'카카오뱅크','7766')`, [w2]);
wpi = await one(`SELECT * FROM public.wage_payment_instructions WHERE attendance_id=$1`, [att2]);
ok(wpi.bank_name_snapshot === '카카오뱅크' && wpi.account_last4_snapshot === '7766' && !!wpi.bank_account_id, '나중에 주 계좌를 등록하면 승인 전 지급 지시에 채워짐');

console.log('[① 공고 근무 정정 (D7)]');
const w3 = (await one(`INSERT INTO public.workers(auth_user_id) VALUES(gen_random_uuid()) RETURNING id`)).id;
const sh3 = await mkShift('2026-11-09', '09:00', '18:00');
const app3 = (await one(`INSERT INTO public.shift_applications(shift_id,worker_id,status) VALUES($1,$2,'accepted') RETURNING id`, [sh3, w3])).id;
const att3 = (await one(`INSERT INTO public.shift_attendances(shift_id,worker_id,application_id,check_in_at,late_minutes) VALUES($1,$2,$3,$4,40) RETURNING id`, [sh3, w3, app3, kst('2026-11-09 10:00')])).id;
const correct = async (id, inAt, outAt, reason = '근무자 요청으로 퇴근 누락 보완') => {
  try { return (await one(`SELECT public.correct_shift_attendance($1,$2::timestamptz,$3::timestamptz,$4) r`, [id, kst(inAt), kst(outAt), reason])).r; }
  catch (e) { return { error: e.message }; }
};
await db.exec(`SET test.admin = 'off'`);
r = await correct(att3, '2026-11-09 09:00', '2026-11-09 18:00');
ok(/권한/.test(r.error ?? ''), '사업장 관리자가 아니면 거부', JSON.stringify(r));
await db.exec(`SET test.admin = 'on'`);
r = await correct(att3, '2026-11-09 09:00', '2026-11-09 18:00', '짧음');
ok(/사유/.test(r.error ?? ''), '사유 5자 미만 거부');
r = await correct(att3, '2026-11-09 09:00', '2026-11-10 10:00');
ok(/24시간/.test(r.error ?? ''), '24시간 넘는 근무 거부');
r = await correct(att3, '2026-11-07 09:00', '2026-11-07 18:00');
ok(/근무일/.test(r.error ?? ''), '다른 날 출근 시각 거부');
r = await correct(att3, '2026-11-09 09:00', '2099-01-01 18:00');
ok(/지금보다/.test(r.error ?? ''), '미래 퇴근 시각 거부');
r = await correct(att3, '2026-11-09 09:00', '2026-11-09 18:00');
ok(r.ok === true && r.gross === 96000, '퇴근 누락을 18:00 으로 정정 → 96,000원 (지금 시각이 아님)', JSON.stringify(r));
let a3 = await one(`SELECT * FROM public.shift_attendances WHERE id=$1`, [att3]);
ok(a3.late_minutes === 0 && a3.check_out_method === 'ADMIN' && a3.manual_override_reason.includes('보완'), '지각 40분 → 0분으로 다시 계산, 처리 방식·사유 남김');
ok((await one(`SELECT status FROM public.shift_applications WHERE id=$1`, [app3])).status === 'completed', '지원 상태 완료');
wpi = await one(`SELECT * FROM public.wage_payment_instructions WHERE attendance_id=$1`, [att3]);
ok(wpi?.gross_amount === 96000 && wpi.net_amount === 96000, '지급 지시 금액 96,000원');
await db.query(`UPDATE public.wage_payment_instructions SET deduction_status='hospital_confirmed', income_tax_amount=1000, net_amount=95000 WHERE attendance_id=$1`, [att3]);
r = await correct(att3, '2026-11-09 09:00', '2026-11-09 14:00', '실제 퇴근 14시로 정정합니다');
ok(r.ok === true && r.gross === 54000, '이미 퇴근한 기록도 다시 정정 → 5시간−휴게30분 54,000원', JSON.stringify(r));
wpi = await one(`SELECT * FROM public.wage_payment_instructions WHERE attendance_id=$1`, [att3]);
ok(wpi.gross_amount === 54000 && wpi.net_amount === 54000 && wpi.deduction_status === 'unconfirmed' && wpi.income_tax_amount === 0, '금액이 바뀌면 확인했던 공제를 되돌려 다시 확인하게 함');
a3 = await one(`SELECT early_leave_minutes FROM public.shift_attendances WHERE id=$1`, [att3]);
ok(a3.early_leave_minutes === 230, '조퇴 분 다시 계산(18:00−14:00=240분 − 유예 10분)', String(a3.early_leave_minutes));
const logs = (await db.query(`SELECT before_data, after_data FROM public.audit_logs WHERE entity_id=$1 AND action='attendance.shift_correct'`, [att3])).rows;
ok(logs.length === 2 && !JSON.stringify(logs).includes('location'), '정정마다 감사 기록 1줄, 위치 좌표는 남기지 않음');
await db.query(`UPDATE public.wage_payment_instructions SET status='approved' WHERE attendance_id=$1`, [att3]);
r = await correct(att3, '2026-11-09 09:00', '2026-11-09 18:00');
ok(/승인·지급/.test(r.error ?? ''), '승인된 지급 지시가 있으면 정정 거부');
ok((await one(`SELECT gross_amount FROM public.wage_payment_instructions WHERE attendance_id=$1`, [att3])).gross_amount === 54000, '승인된 금액은 그대로');
await db.query(`UPDATE public.wage_payment_instructions SET status='draft' WHERE attendance_id=$1`, [att3]);
await db.query(`INSERT INTO public.attendance_period_closures VALUES($1,'2026-11-01','closed')`, [fac]);
r = await correct(att3, '2026-11-09 09:00', '2026-11-09 18:00');
ok(/마감/.test(r.error ?? ''), '마감된 달은 정정 거부');
await db.exec(`DELETE FROM public.attendance_period_closures`);
// 야간 근무: 전날 밤 출근 허용
const sh4 = await mkShift('2026-11-11', '22:00', '06:00');
const app4 = (await one(`INSERT INTO public.shift_applications(shift_id,worker_id,status) VALUES($1,$2,'accepted') RETURNING id`, [sh4, w3])).id;
const att4 = (await one(`INSERT INTO public.shift_attendances(shift_id,worker_id,application_id,check_in_at) VALUES($1,$2,$3,$4) RETURNING id`, [sh4, w3, app4, kst('2026-11-11 21:55')])).id;
r = await correct(att4, '2026-11-11 22:00', '2026-11-12 06:00', '야간 근무 퇴근 누락 보완');
ok(r.ok === true && r.gross > 0, '야간 22~06 정정 통과(자정 넘김)', JSON.stringify(r));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
