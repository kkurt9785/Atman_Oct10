BEGIN;
CREATE SCHEMA qa_payroll_integrity;
GRANT USAGE ON SCHEMA qa_payroll_integrity TO authenticated;
CREATE TABLE public.facilities(id uuid PRIMARY KEY,name text);
CREATE TABLE public.workers(id uuid PRIMARY KEY,auth_user_id uuid);
CREATE TABLE public.facility_staff(id uuid PRIMARY KEY,facility_id uuid,worker_id uuid,pay_basis text,pay_rate integer,contract_start date,contract_end date,bank_name text,account_last4 text);
CREATE TABLE public.staff_attendances(id uuid PRIMARY KEY,facility_id uuid,staff_id uuid,work_date date,status text,check_in_at timestamptz,check_out_at timestamptz,break_minutes integer);
CREATE TABLE public.attendance_period_closures(facility_id uuid,period_month date,status text);
CREATE TABLE public.staff_wage_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facility_id uuid,staff_id uuid,period_month date,pay_basis text,pay_rate integer,worked_minutes integer,worked_days integer,gross_amount integer,net_amount integer,status text,approved_by uuid,approved_at timestamptz,exported_at timestamptz,paid_at timestamptz,updated_at timestamptz,UNIQUE(staff_id,period_month));
CREATE TABLE public.gig_payouts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facility_id uuid,staff_id uuid,period_start date,period_end date,status text,net_amount integer,amount integer,pay_at date,worker_confirm_status text);
CREATE TABLE public.notification_outbox(worker_auth_user_id uuid,event_type text,dedupe_key text UNIQUE,title text,body text,data jsonb);
CREATE TABLE public.audit_logs(actor_type text,actor_id uuid,action text,entity_type text,entity_id uuid,after_data jsonb);
CREATE FUNCTION public.can_manage_facility(uuid,text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='10000000-0000-4000-8000-000000000001'::uuid $$;
CREATE FUNCTION public.can_view_facility_payroll(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='10000000-0000-4000-8000-000000000001'::uuid $$;
-- APPLY_MIGRATION
CREATE FUNCTION pg_temp.check_that(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.reject(sql text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'Unexpected success: %',sql;
END $$;
INSERT INTO public.facilities VALUES('20000000-0000-4000-8000-000000000001','검증 사업장');
INSERT INTO public.workers VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
INSERT INTO public.facility_staff VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','hourly',12000,NULL,NULL,'검증은행','1234');
INSERT INTO public.staff_attendances VALUES('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-09-03','completed','2026-09-03 09:00+09','2026-09-03 18:00+09',60);
CREATE FUNCTION pg_temp.transition(action text,amount integer DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 SELECT public.transition_staff_wage_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-09-01',action,amount);
$$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',true);
SELECT pg_temp.reject('SELECT pg_temp.transition(''approve'')','권한');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.reject('SELECT pg_temp.transition(''mark_paid'')','현재 급여 상태');
SELECT pg_temp.reject('SELECT pg_temp.transition(''mark_exported'')','현재 급여 상태');
SELECT pg_temp.reject('SELECT pg_temp.transition(NULL)','처리 요청');
SELECT pg_temp.reject('SELECT pg_temp.transition(''approve'')','먼저 마감');
INSERT INTO public.attendance_period_closures VALUES('20000000-0000-4000-8000-000000000001','2026-09-01','closed');
UPDATE public.staff_attendances SET check_out_at=NULL;
SELECT pg_temp.reject('SELECT pg_temp.transition(''approve'')','근태');
UPDATE public.staff_attendances SET check_out_at='2026-09-03 18:00+09';
-- Audit failure must roll back the wage record as well.
CREATE FUNCTION pg_temp.fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa forced write failure'; END $$;
CREATE TRIGGER qa_fail_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_write();
SELECT pg_temp.reject('SELECT pg_temp.transition(''approve'')','qa forced');
SELECT pg_temp.check_that(NOT EXISTS(SELECT 1 FROM public.staff_wage_payments),'audit failure rolls back approval');
DROP TRIGGER qa_fail_audit ON public.audit_logs;
SET LOCAL ROLE authenticated;
SELECT public.transition_staff_wage_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-09-01','approve',NULL);
RESET ROLE;
SELECT pg_temp.check_that((SELECT worked_minutes=480 AND worked_days=1 AND gross_amount=96000 AND status='approved' FROM public.staff_wage_payments),'recorded break and approval snapshot');
SELECT pg_temp.reject('SELECT pg_temp.transition(''approve'')','현재 급여 상태');
SELECT pg_temp.reject('SELECT pg_temp.transition(''mark_paid'')','현재 급여 상태');
UPDATE public.facility_staff SET pay_rate=NULL,pay_basis=NULL,contract_end='2026-01-01';
SELECT pg_temp.transition('mark_exported');
SELECT pg_temp.transition('mark_paid');
SELECT pg_temp.reject('SELECT pg_temp.transition(''mark_paid'')','현재 급여 상태');
SELECT pg_temp.check_that((SELECT gross_amount=96000 AND pay_rate=12000 AND status='paid' FROM public.staff_wage_payments),'later staff edits do not rewrite approved wages');
SELECT pg_temp.check_that((SELECT count(*)=3 FROM public.audit_logs),'exactly one audit per successful transition');
SELECT pg_temp.reject($q$INSERT INTO public.gig_payouts(facility_id,staff_id,period_start,period_end,status,amount,net_amount) VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-09-03','2026-09-03','paid',96000,96000)$q$,'확정된 월 급여');
-- October payout/outbox: one notice per transition, using rolling-deploy keys.
INSERT INTO public.gig_payouts(id,facility_id,staff_id,period_start,period_end,status,amount,net_amount,pay_at) VALUES('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-10-01','2026-10-01','scheduled',100000,96700,'2026-10-16');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.notification_outbox),'scheduled payout enqueues once');
UPDATE public.gig_payouts SET status='scheduled';
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.notification_outbox),'same state does not enqueue again');
CREATE TRIGGER qa_fail_notice BEFORE INSERT ON public.notification_outbox FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_write();
SELECT pg_temp.reject('UPDATE public.gig_payouts SET status=''paid''','qa forced');
SELECT pg_temp.check_that((SELECT status='scheduled' FROM public.gig_payouts),'notice failure rolls back paid transition');
DROP TRIGGER qa_fail_notice ON public.notification_outbox;
UPDATE public.gig_payouts SET status='paid';
UPDATE public.gig_payouts SET worker_confirm_status='received';
SELECT pg_temp.check_that((SELECT count(*)=2 FROM public.notification_outbox),'paid and confirmation do not double-notify');
SELECT pg_temp.check_that(EXISTS(SELECT 1 FROM public.notification_outbox WHERE dedupe_key='payout.paid:50000000-0000-4000-8000-000000000001:paid' AND body LIKE '96,700%' AND data->>'payout_id'='50000000-0000-4000-8000-000000000001'),'net amount, deep link and legacy key preserved');
-- A proration amount must be explicit, not a silent full-month salary.
UPDATE public.facility_staff SET pay_basis='monthly',pay_rate=3000000,contract_start='2026-08-15',contract_end=NULL;
INSERT INTO public.attendance_period_closures VALUES('20000000-0000-4000-8000-000000000001','2026-08-01','closed');
SELECT pg_temp.reject($q$SELECT public.transition_staff_wage_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-08-01','approve',NULL)$q$,'일할계산');
SELECT public.transition_staff_wage_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-08-01','approve',1500000);
SELECT pg_temp.check_that((SELECT gross_amount=1500000 FROM public.staff_wage_payments WHERE period_month='2026-08-01'),'explicit proration saved');
-- Existing staff on daily pay use actual days, not hours or the full monthly rate.
UPDATE public.facility_staff SET pay_basis='daily',pay_rate=100000,contract_start=NULL;
INSERT INTO public.attendance_period_closures VALUES('20000000-0000-4000-8000-000000000001','2026-07-01','closed');
INSERT INTO public.staff_attendances SELECT gen_random_uuid(),facility_id,staff_id,'2026-07-03','completed','2026-07-03 09:00+09','2026-07-03 18:00+09',0 FROM public.staff_attendances LIMIT 1;
SELECT public.transition_staff_wage_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-07-01','approve',NULL);
SELECT pg_temp.check_that((SELECT worked_minutes=540 AND worked_days=1 AND gross_amount=100000 FROM public.staff_wage_payments WHERE period_month='2026-07-01'),'existing daily staff and explicit zero break');
-- Reverse direction also rejects overlap: gig payout first, monthly approval later.
INSERT INTO public.attendance_period_closures VALUES('20000000-0000-4000-8000-000000000001','2026-06-01','closed');
INSERT INTO public.gig_payouts(facility_id,staff_id,period_start,period_end,status,amount,net_amount) VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-06-03','2026-06-03','paid',100000,100000);
SELECT pg_temp.reject($q$SELECT public.transition_staff_wage_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-06-01','approve',NULL)$q$,'단기근로 지급 기록');
SELECT 'PASS: atomic payroll state machine, snapshots, audit, cross-ledger overlap, transactional outbox' AS result;
ROLLBACK;
