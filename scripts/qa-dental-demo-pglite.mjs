// 비공개 치과 시연(20261113120000·130000) DB 시험 — Docker 없이 PGlite(메모리 Postgres). 운영·연결 DB 를 쓰지 않는다.
// 실행: npm i --no-save @electric-sql/pglite@0.2.17 && node scripts/qa-dental-demo-pglite.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const MIG = new URL('../supabase/migrations', import.meta.url).pathname;
const read = (f) => readFileSync(`${MIG}/${f}`, 'utf8');
const grab = (src, re) => { const m = src.match(re); if (!m) throw new Error('not found ' + re); return m[0]; };
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗', l, x); } };
const one = async (s, p) => (await db.query(s, p)).rows[0];
const all = async (s, p) => (await db.query(s, p)).rows;

await db.exec(`
CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE DOMAIN public.geography AS text;
CREATE FUNCTION public.ST_MakePoint(x float8, y float8) RETURNS text LANGUAGE sql AS $$ SELECT x||','||y $$;
CREATE FUNCTION public.ST_SetSRID(g text, s int) RETURNS text LANGUAGE sql AS $$ SELECT g $$;
CREATE TABLE public.facilities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, facility_type text, business_registration_number text UNIQUE,
  representative_name text, address_text text, location public.geography, contact_name text, contact_phone text, contact_email text,
  is_active boolean DEFAULT true, approved_at timestamptz, is_demo boolean DEFAULT false, deleted_at timestamptz, admin_user_id uuid,
  invite_code_hash text, invite_code_expires_at timestamptz, registration_source text, employee_count int);
CREATE TABLE public.facility_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, plan_code text, status text, billing_cycle text,
  trial_started_at timestamptz, trial_ends_at timestamptz, current_period_start date, current_period_end date, cancel_at_period_end boolean, updated_at timestamptz DEFAULT now());
CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text);
CREATE TABLE public.workers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kakao_id text UNIQUE NOT NULL, name text NOT NULL, phone text, birth_date date NOT NULL,
  role text NOT NULL, verification_status text, verified_at timestamptz, experience_years text, last_workplace text, department_tags text[],
  last_active_at timestamptz, is_demo boolean, deleted_at timestamptz, auth_user_id uuid);
CREATE TABLE public.facility_attendance_settings(facility_id uuid PRIMARY KEY, authentication_mode text, gps_radius_meters int, max_gps_accuracy_meters int);
CREATE TABLE public.facility_attendance_qr(facility_id uuid PRIMARY KEY, is_active boolean);
CREATE TABLE public.facility_staff(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, worker_id uuid, name text, phone text, role text, department text,
  source text, engagement_type text, contract_start date, contract_end date, default_start_time time, default_end_time time, default_break_minutes int,
  status text, pay_basis text, pay_rate int, work_weekdays smallint[], weekday_hours jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
CREATE TABLE public.staff_attendances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, staff_id uuid REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  work_date date, scheduled_start time, scheduled_end time, check_in_at timestamptz, check_out_at timestamptz, break_minutes int, status text,
  check_in_method text, check_out_method text, check_in_status text, check_out_status text, late_minutes int DEFAULT 0, early_leave_minutes int DEFAULT 0,
  checkout_requested_at timestamptz, missing_checkout_at timestamptz, note text, updated_at timestamptz, UNIQUE(staff_id, work_date));
CREATE TABLE public.staff_attendance_change_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, attendance_id uuid REFERENCES public.staff_attendances(id) ON DELETE RESTRICT);
CREATE TABLE public.staff_leave_balances(facility_id uuid, staff_id uuid REFERENCES public.facility_staff(id) ON DELETE CASCADE, leave_year int, granted_minutes int, used_minutes int, note text, updated_at timestamptz, UNIQUE(staff_id, leave_year));
CREATE TABLE public.staff_leave_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, staff_id uuid REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  leave_type text, half_day_period text, start_date date, end_date date, requested_minutes int, reason text, status text);
`);
await db.exec(grab(read('20261110100000_dental_beta_roles_weekday_hours_leave_notify.sql'), /CREATE OR REPLACE FUNCTION public\.staff_start_time_on[\s\S]*?\$\$;\s*CREATE OR REPLACE FUNCTION public\.staff_end_time_on[\s\S]*?\$\$;/));
await db.exec(grab(read('20261002120000_demo_plan_and_trial_on_claim.sql'), /CREATE OR REPLACE FUNCTION public\.ensure_demo_subscriptions\(\)[\s\S]*?\n\$\$;/));
const inbox = read('20261112150000_notification_qa_and_demo_inbox.sql');
await db.exec(grab(inbox, /CREATE OR REPLACE FUNCTION public\.seed_demo_workroom\(p_facility_id uuid\)[\s\S]*?\n\$\$;/));
await db.exec(grab(inbox, /CREATE OR REPLACE FUNCTION public\.seed_demo_workrooms_for\(p_user uuid\)[\s\S]*?\n\$\$;/));
await db.exec(grab(read('20261112120000_demo_names_room_and_conversations.sql'), /CREATE OR REPLACE FUNCTION public\.seed_demo_workrooms\(\)[\s\S]*?\n\$\$;/));

const mig = read('20261113120000_private_dental_demo.sql');
await db.exec(mig);
await db.exec(mig); // 다시 돌려도 안전
console.log('[시연 사업장·직원]');
const f = await one(`SELECT * FROM public.facilities WHERE business_registration_number='DEMO-PRIVATE-DENTAL-GWANGGYO'`);
ok(f?.name === '광교본치과의원' && f.facility_type === 'small_hospital' && f.is_demo, '사업장 1곳, 병원·의원 유형, 시연 표시');
ok((await one(`SELECT count(*)::int c FROM public.facilities`)).c === 1, '두 번 돌려도 사업장 1곳');
const staff = await all(`SELECT name, role, worker_id, phone FROM public.facility_staff WHERE facility_id=$1 ORDER BY phone`, [f.id]);
ok(staff.length === 5 && staff.filter((s) => s.worker_id).length === 2, '직원 5명, 앱 연결 2명', JSON.stringify(staff));
ok(staff.map((s) => s.role).join(',') === 'dental_hygienist,dental_hygienist,dental_hygienist,coordinator,admin', '위생사 3·코디·실장');
const hist = await one(`SELECT count(*)::int c, count(*) FILTER (WHERE status='leave')::int leave, count(*) FILTER (WHERE late_minutes>0)::int late,
  min(work_date) mn, max(work_date) mx FROM public.staff_attendances WHERE facility_id=$1 AND work_date < (now() AT TIME ZONE 'Asia/Seoul')::date`, [f.id]);
ok(hist.c > 100 && hist.leave >= 1 && hist.late >= 2, `지난달~어제 근태 ${hist.c}건(연차 ${hist.leave}, 지각 ${hist.late})`);
const sun = await one(`SELECT count(*)::int c FROM public.staff_attendances WHERE facility_id=$1 AND extract(isodow FROM work_date)=7`, [f.id]);
ok(sun.c === 0, '일요일 근무 기록 없음');
const sat = await one(`SELECT scheduled_start::text st, scheduled_end::text et FROM public.staff_attendances a JOIN public.facility_staff s ON s.id=a.staff_id
  WHERE s.phone='DEMO-DENTAL-01' AND extract(isodow FROM a.work_date)=6 LIMIT 1`);
ok(sat?.st === '09:30:00' && sat?.et === '14:00:00', '토요일은 09:30~14:00', JSON.stringify(sat));
const wed = await one(`SELECT scheduled_end::text et FROM public.staff_attendances a JOIN public.facility_staff s ON s.id=a.staff_id
  WHERE s.phone='DEMO-DENTAL-02' AND extract(isodow FROM a.work_date)=3 LIMIT 1`);
ok(wed?.et === '21:00:00', '오세린 수요일 야간 진료 21:00', JSON.stringify(wed));
const silly = await one(`SELECT count(*)::int c FROM public.staff_attendances WHERE facility_id=$1 AND check_in_at > now()`, [f.id]);
ok(silly.c === 0, '아직 오지 않은 출근 시각은 없음');
const pend = await all(`SELECT r.leave_type, r.half_day_period, s.name FROM public.staff_leave_requests r JOIN public.facility_staff s ON s.id=r.staff_id WHERE r.status='pending'`);
ok(pend.length === 1 && pend[0].name === '오세린' && pend[0].half_day_period === 'pm', '대기 반차 1건(오세린 오후)', JSON.stringify(pend));

console.log('[매일 되살리기 — 방문자 수정 이력이 있어도]');
const anyAtt = (await one(`SELECT a.id FROM public.staff_attendances a WHERE a.facility_id=$1 LIMIT 1`, [f.id])).id;
await db.query(`INSERT INTO public.staff_attendance_change_logs(facility_id, attendance_id) VALUES($1,$2)`, [f.id, anyAtt]);
const r = await all(`SELECT * FROM public.refresh_demo_dental_workforce()`);
ok(r.find((x) => x.kind === 'dental_staff')?.count == 5, '다시 만들어도 직원 5명', JSON.stringify(r));
ok((await one(`SELECT count(*)::int c FROM public.staff_attendance_change_logs`)).c === 0, '수정 이력 때문에 막히지 않음');
ok((await one(`SELECT count(*)::int c FROM public.staff_leave_requests WHERE status='pending'`)).c === 1, '대기 반차가 쌓이지 않음(1건)');

console.log('[대화방·검색]');
const wr = await one(`SELECT pg_get_functiondef('public.seed_demo_workroom(uuid)'::regprocedure) d`);
ok((wr.d.match(/'dental'/g) || []).length >= 9 && wr.d.includes("WHEN 'dental' THEN '원장'"), '대화방 치과 말투 행·원장 이름 추가');
for (const sig of ['public.seed_demo_workrooms()', 'public.seed_demo_workrooms_for(uuid)']) {
  const d = (await one(`SELECT pg_get_functiondef($1::regprocedure) d`, [sig])).d;
  ok((d.match(/DEMO-PRIVATE-DENTAL-GWANGGYO/g) || []).length === 1, `${sig} 목록에 한 번만 추가`);
}
const uid = (await one(`SELECT gen_random_uuid() id`)).id;
await db.query(`INSERT INTO public.profiles VALUES($1,'admin')`, [uid]);
await db.exec(`SET test.uid='${uid}'`);
await db.query(`INSERT INTO public.facilities(name,facility_type,business_registration_number,is_demo) VALUES('본치과 공개시연','small_hospital','DEMO-TARGET-9999',true)`);
const found = await all(`SELECT name FROM public.search_claimable_facilities('본치과')`);
ok(found.length === 1 && found[0].name === '본치과 공개시연', '사업장 검색에 광교본치과의원은 안 나옴(공개 시연은 그대로)', JSON.stringify(found));
console.log('[다듬기 20261113130000]');
await db.query(`INSERT INTO public.facility_subscriptions(facility_id,plan_code,status,billing_cycle) VALUES($1,'pro','active','monthly')`, [f.id]).catch(()=>{});
const pol = read('20261113130000_dental_demo_polish.sql');
await db.exec(pol); await db.exec(pol);
ok((await one(`SELECT count(worker_id)::int c FROM public.facility_staff WHERE facility_id=$1`, [f.id])).c === 5, '직원 5명 모두 앱 연결');
ok((await one(`SELECT employee_count c FROM public.facilities WHERE id=$1`, [f.id])).c === 5, '총원 5명');
const plans = await all(`SELECT f.name, s.plan_code FROM public.facility_subscriptions s JOIN public.facilities f ON f.id=s.facility_id WHERE s.status='active' ORDER BY f.name`);
ok(plans.find((x) => x.name === '광교본치과의원')?.plan_code === 'clinic' && plans.find((x) => x.name === '본치과 공개시연')?.plan_code === 'pro', '치과 시연만 Clinic, 다른 시연은 Pro 그대로', JSON.stringify(plans));
ok((await one(`SELECT count(*)::int c FROM public.staff_attendances WHERE facility_id=$1`, [f.id])).c > 100, '근태 기록 다시 채워짐');
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
