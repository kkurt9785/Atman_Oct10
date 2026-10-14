-- Regression of defects first reproduced as characterization tests.
-- Functions are copied verbatim from migrations; only public schema is remapped.
BEGIN;
CREATE SCHEMA qa_md_remaining;
GRANT USAGE ON SCHEMA qa_md_remaining TO authenticated;
CREATE TABLE public.facilities(id uuid PRIMARY KEY,name text,admin_user_id uuid,is_demo boolean DEFAULT false,is_active boolean DEFAULT true,deleted_at timestamptz,closed_at timestamptz,closed_reason text,updated_at timestamptz);
CREATE TABLE public.facility_admin_access(facility_id uuid,user_id uuid,access_role text,can_view_payroll boolean);
CREATE TABLE public.workers(id uuid,auth_user_id uuid,deleted_at timestamptz);
CREATE TABLE public.facility_staff(id uuid,facility_id uuid,worker_id uuid,name text,status text,updated_at timestamptz);
CREATE TABLE public.shifts(id uuid,facility_id uuid,status text,shift_date date,start_time time,end_time time,is_overnight boolean,cancelled_at timestamptz,updated_at timestamptz);
CREATE TABLE public.shift_applications(id uuid,shift_id uuid,worker_id uuid,status text,cancelled_at timestamptz);
CREATE TABLE public.facility_staff_invites(facility_id uuid,status text);
CREATE TABLE public.gig_payouts(id uuid,facility_id uuid,staff_id uuid,status text,amount numeric,net_amount numeric,pay_at date,paid_at timestamptz,worker_confirm_status text,worker_confirmed_at timestamptz,worker_confirm_note text,updated_at timestamptz);
CREATE TABLE public.wage_payment_instructions(facility_id uuid,status text);
CREATE TABLE public.staff_wage_payments(facility_id uuid,status text);
CREATE TABLE public.staff_attendances(facility_id uuid,staff_id uuid,check_in_at timestamptz,check_out_at timestamptz,status text);
CREATE TABLE public.notification_outbox(worker_auth_user_id uuid,event_type text,dedupe_key text UNIQUE,title text,body text,data jsonb,status text DEFAULT 'pending');
CREATE TABLE public.audit_logs(actor_type text,actor_id uuid,action text,entity_type text,entity_id uuid,before_data jsonb);
CREATE TABLE public.profiles(id uuid,role text,onboarding_done boolean,updated_at timestamptz);
CREATE TABLE public.push_subscriptions(worker_id uuid,endpoint text);
CREATE FUNCTION public.is_demo_account(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.current_worker_id() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.workers WHERE auth_user_id=auth.uid() LIMIT 1 $$;
ALTER TABLE public.facility_staff ADD COLUMN worker_kind text DEFAULT 'gig';
ALTER TABLE public.staff_attendances ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN work_date date DEFAULT current_date;
ALTER TABLE public.gig_payouts ADD COLUMN attendance_ids uuid[], ADD COLUMN period_start date, ADD COLUMN period_end date, ADD COLUMN covered_until timestamptz;
-- APPLY_FUNCTIONS
CREATE FUNCTION pg_temp.check_that(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE '%', label;
END $$;
CREATE FUNCTION pg_temp.reject(sql text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'Unexpected success: %',sql;
END $$;

INSERT INTO public.facilities(id,name,admin_user_id) VALUES
 ('20000000-0000-4000-8000-000000000001','owned','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','ownerless',NULL),
 ('20000000-0000-4000-8000-000000000003','unsettled','10000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('SELECT public.close_my_facility(''20000000-0000-4000-8000-000000000001'')','소유자');
SELECT pg_temp.reject('SELECT public.close_my_facility(''20000000-0000-4000-8000-000000000002'')','소유자');
RESET ROLE;
SELECT pg_temp.check_that((SELECT deleted_at IS NULL FROM public.facilities WHERE name='ownerless'),'PASS C9: NULL owner cannot bypass authorization');

INSERT INTO public.facility_staff VALUES('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003',NULL,'unpaid staff','active',NULL);
INSERT INTO public.staff_attendances VALUES('20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',now()-interval '1 day',NULL,'working');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.reject('SELECT public.close_my_facility(''20000000-0000-4000-8000-000000000003'')','퇴근하지');
UPDATE public.staff_attendances SET check_out_at=now(),status='completed';
SELECT pg_temp.reject('SELECT public.close_my_facility(''20000000-0000-4000-8000-000000000003'')','지급 확인');
SELECT pg_temp.check_that((SELECT deleted_at IS NULL FROM public.facilities WHERE name='unsettled'),'PASS C9: open and unpaid completed attendance both block closure');

INSERT INTO public.workers VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',NULL);
INSERT INTO public.facility_staff VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','worker','active',NULL);
INSERT INTO public.facility_admin_access VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','operator',false);
INSERT INTO public.gig_payouts(id,facility_id,staff_id,status,amount,net_amount,pay_at) VALUES('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','scheduled',100000,100000,(now() AT TIME ZONE 'Asia/Seoul')::date);
SELECT public.run_gig_payout_reminders();
SELECT public.run_gig_payout_reminders();
SELECT pg_temp.check_that((SELECT count(*)=2 FROM public.notification_outbox WHERE event_type LIKE 'payout.due%'),'PASS C11: repeated daily execution deduplicates per payout and recipient');
SELECT pg_temp.check_that(NOT EXISTS(SELECT 1 FROM public.notification_outbox WHERE worker_auth_user_id='10000000-0000-4000-8000-000000000003'),'PASS C11: payroll-disabled operator receives no wage notice');
SELECT pg_temp.reject('SELECT public.close_my_facility(''20000000-0000-4000-8000-000000000001'')','지급 대기');
UPDATE public.gig_payouts SET status='paid',paid_at=now()-interval '4 days';
SELECT public.run_gig_payout_reminders(); SELECT public.run_gig_payout_reminders();
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.notification_outbox WHERE event_type='payout.confirm'),'PASS C11: 3-day confirmation reminder is sent once');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
CREATE TRIGGER qa_ledger_update BEFORE UPDATE ON public.gig_payouts FOR EACH ROW EXECUTE FUNCTION public.guard_gig_payout_attendances();
SELECT pg_temp.reject('SELECT public.confirm_my_gig_payout(''50000000-0000-4000-8000-000000000001'',NULL)','상태');
SELECT public.confirm_my_gig_payout('50000000-0000-4000-8000-000000000001',false,'not received');
SELECT public.confirm_my_gig_payout('50000000-0000-4000-8000-000000000001',false,'not received');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.notification_outbox WHERE event_type='payout.missing'),'PASS C11: repeated missing state does not re-notify; ledger accepts confirmation note');
-- Model an identical missing notice from a previous minute without changing DB time.
UPDATE public.notification_outbox SET dedupe_key=dedupe_key||':previous-minute' WHERE event_type='payout.missing';
SELECT public.confirm_my_gig_payout('50000000-0000-4000-8000-000000000001',false,'not received');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.notification_outbox WHERE event_type='payout.missing'),'PASS C11: dedupe does not depend on minute of retry');
SELECT public.confirm_my_gig_payout('50000000-0000-4000-8000-000000000001',true);
SELECT public.confirm_my_gig_payout('50000000-0000-4000-8000-000000000001',false);
SELECT pg_temp.check_that((SELECT count(*)=2 FROM public.notification_outbox WHERE event_type='payout.missing'),'PASS C11: a new received-to-missing transition notifies once');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',true);
SELECT pg_temp.reject('SELECT public.confirm_my_gig_payout(''50000000-0000-4000-8000-000000000001'',true)','로그인');

-- Inactive is not the same as closed; withdrawal must not orphan a facility.
INSERT INTO public.facilities(id,name,admin_user_id,is_active) VALUES('20000000-0000-4000-8000-000000000004','inactive not closed','10000000-0000-4000-8000-000000000004',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT pg_temp.reject('SELECT public.withdraw_my_admin_account()','사업장');
SELECT pg_temp.check_that((SELECT admin_user_id IS NOT NULL AND deleted_at IS NULL FROM public.facilities WHERE name='inactive not closed'),'PASS C9: inactive unclosed facility blocks withdrawal');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
INSERT INTO public.push_subscriptions VALUES('10000000-0000-4000-8000-000000000002','qa-worker-endpoint');
SELECT public.withdraw_my_admin_account();
SELECT pg_temp.check_that(EXISTS(SELECT 1 FROM public.push_subscriptions),'PASS C9: shared worker identity keeps push subscription');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT public.close_my_facility('20000000-0000-4000-8000-000000000001');
SELECT public.close_my_facility('20000000-0000-4000-8000-000000000001');
SELECT pg_temp.check_that((SELECT deleted_at IS NOT NULL FROM public.facilities WHERE name='owned')
  AND EXISTS(SELECT 1 FROM public.gig_payouts WHERE status='paid'),
  'PASS C9: eligible owner can close idempotently without deleting paid history');
SELECT 'Regression complete; all fixtures rolled back; not full release approval' AS result;
ROLLBACK;
