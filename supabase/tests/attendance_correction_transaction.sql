-- Inject migration at marker, replace public. with qa_attendance_correction.
-- All fixtures, functions and changes roll back. Does not use operational data.
BEGIN;
CREATE SCHEMA qa_attendance_correction;
GRANT USAGE ON SCHEMA qa_attendance_correction TO authenticated;
CREATE TABLE public.facility_staff(id uuid PRIMARY KEY,facility_id uuid);
CREATE TABLE public.staff_attendances(id uuid PRIMARY KEY,facility_id uuid,staff_id uuid,work_date date,
  check_in_at timestamptz,check_out_at timestamptz,break_minutes integer,status text,
  corrected_by uuid,correction_reason text,approved_by uuid,approved_at timestamptz,updated_at timestamptz);
CREATE TABLE public.attendance_period_closures(facility_id uuid,period_month date,status text,reason text,
  closed_by uuid,closed_at timestamptz,reopened_by uuid,reopened_at timestamptz,updated_at timestamptz,PRIMARY KEY(facility_id,period_month));
CREATE TABLE public.staff_attendance_change_logs(facility_id uuid,attendance_id uuid,changed_by uuid,action text,reason text,before_data jsonb,after_data jsonb);
CREATE TABLE public.gig_payouts(staff_id uuid,status text,attendance_ids uuid[],period_start date,period_end date,covered_until timestamptz);
CREATE TABLE public.staff_wage_payments(staff_id uuid,period_month date,status text);
CREATE FUNCTION public.can_manage_facility(p_id uuid,p_roles text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN auth.uid()='10000000-0000-4000-8000-000000000001'::uuid AND p_id='20000000-0000-4000-8000-000000000001'::uuid THEN true ELSE NULL END;
$$;
INSERT INTO public.facility_staff VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
INSERT INTO public.staff_attendances(id,facility_id,staff_id,work_date,check_in_at,check_out_at,break_minutes,status)
VALUES('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2020-02-10','2020-02-10 09:00+09','2020-02-10 18:00+09',0,'completed');
-- APPLY_MIGRATION
CREATE FUNCTION pg_temp.correct(p_end timestamptz DEFAULT '2020-02-10 18:00+09',p_break integer DEFAULT 30,p_reason text DEFAULT '직원 요청으로 시간 보완') RETURNS void LANGUAGE sql AS $$
  SELECT public.correct_staff_attendance('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','2020-02-01','2020-02-10 09:00+09',p_end,p_break,p_reason);
$$;
CREATE FUNCTION pg_temp.period(p_action text,p_month date DEFAULT '2020-02-01') RETURNS void LANGUAGE sql AS $$
  SELECT public.set_attendance_period_state('20000000-0000-4000-8000-000000000001',p_month,p_action,'근태 확인 완료 사유');
$$;
CREATE FUNCTION pg_temp.reject(p_sql text,p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF position(p_expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE;
  END;
  RAISE EXCEPTION 'unexpected success: %',p_sql;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT pg_temp.reject('SELECT pg_temp.correct()','권한');
SELECT pg_temp.reject('SELECT pg_temp.period(''close'')','권한');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.correct();
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.staff_attendance_change_logs)<>1 OR (SELECT break_minutes FROM public.staff_attendances)<>30 THEN RAISE EXCEPTION 'correction/audit missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.staff_attendance_change_logs WHERE changed_by='10000000-0000-4000-8000-000000000001' AND before_data->>'break_minutes'='0' AND after_data->>'break_minutes'='30') THEN RAISE EXCEPTION 'audit snapshot or actor wrong'; END IF;
END $$;

-- Audit insertion failure must undo the attendance UPDATE in the same call.
CREATE FUNCTION public.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.reason='QA audit failure' THEN RAISE EXCEPTION 'QA audit rejected'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER reject_audit BEFORE INSERT ON public.staff_attendance_change_logs FOR EACH ROW EXECUTE FUNCTION public.reject_audit();
SELECT pg_temp.reject('SELECT pg_temp.correct(''2020-02-10 19:00+09'',20,''QA audit failure'')','QA audit rejected');
DO $$ BEGIN
  IF (SELECT check_out_at FROM public.staff_attendances)<>'2020-02-10 18:00+09'::timestamptz OR (SELECT break_minutes FROM public.staff_attendances)<>30 OR (SELECT count(*) FROM public.staff_attendance_change_logs)<>1 THEN RAISE EXCEPTION 'partial correction survived audit failure'; END IF;
END $$;

SELECT pg_temp.reject('SELECT pg_temp.correct(''2020-02-10 09:20+09'',30)','휴게시간');
SELECT pg_temp.reject('SELECT pg_temp.correct(now()+interval ''1 day'')','미래');
SELECT pg_temp.reject('SELECT pg_temp.correct(''2020-02-10 18:00+09'',30,''짧음'')','사유');
SELECT pg_temp.reject('SELECT public.correct_staff_attendance(''20000000-0000-4000-8000-000000000001'',''40000000-0000-4000-8000-000000000001'',''2020-02-01'',''2020-02-11 09:00+09'',''2020-02-11 18:00+09'',30,''근무일 변경 테스트'')','출근 날짜');

INSERT INTO public.gig_payouts VALUES('30000000-0000-4000-8000-000000000001','scheduled',ARRAY['40000000-0000-4000-8000-000000000001']::uuid[],'2020-02-10','2020-02-10','2020-02-10 18:00+09');
SELECT pg_temp.reject('SELECT pg_temp.correct()','지급에 포함');
UPDATE public.gig_payouts SET status='paid';
SELECT pg_temp.reject('SELECT pg_temp.correct()','지급에 포함');
UPDATE public.gig_payouts SET status='cancelled';
SELECT pg_temp.correct();
UPDATE public.gig_payouts SET status='paid',attendance_ids=NULL;
SELECT pg_temp.reject('SELECT pg_temp.correct(''2020-02-10 19:00+09'')','지급에 포함');
UPDATE public.gig_payouts SET status='cancelled';
INSERT INTO public.staff_wage_payments VALUES('30000000-0000-4000-8000-000000000001','2020-02-01','paid');
SELECT pg_temp.reject('SELECT pg_temp.correct()','확정된 월 급여');
UPDATE public.staff_wage_payments SET status='draft';
SELECT pg_temp.correct();

SET LOCAL ROLE authenticated;
SELECT pg_temp.period('close');
SELECT pg_temp.reject('SELECT pg_temp.correct()','재개방');
SELECT pg_temp.period('reopen');
SELECT pg_temp.correct();
SELECT pg_temp.reject('SELECT pg_temp.period(''close'',date_trunc(''month'',now() AT TIME ZONE ''Asia/Seoul'')::date)','다음 달');
RESET ROLE;
UPDATE public.staff_attendances SET check_out_at=NULL,status='working';
SELECT pg_temp.reject('SELECT pg_temp.period(''close'')','퇴근 누락');
SELECT 'PASS: scoped auth, atomic audit rollback, input validation, payout protection, cancellation release, month close/reopen' AS result;
ROLLBACK;
