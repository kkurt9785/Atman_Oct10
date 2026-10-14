-- Isolated fixture for an EMPTY local database; existing tables cause an error.
-- Inject 20261014180000 migration at APPLY_MIGRATION using sed, pipe to psql
-- with ON_ERROR_STOP=1. Everything, including fixture DDL, is rolled back.
BEGIN;
CREATE TABLE public.facility_staff (id uuid PRIMARY KEY, facility_id uuid, worker_kind text, pay_basis text, pay_rate integer);
CREATE TABLE public.staff_attendances (id uuid PRIMARY KEY, staff_id uuid, facility_id uuid, work_date date, status text, check_in_at timestamptz, check_out_at timestamptz, break_minutes integer);
CREATE TABLE public.gig_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid, staff_id uuid,
  period_start date, period_end date, covered_until timestamptz, worked_minutes integer,
  worked_days integer, pay_basis text, pay_rate integer, amount integer,
  withholding_rate numeric DEFAULT 0, withholding_amount integer DEFAULT 0, net_amount integer,
  status text, pay_at date, paid_at timestamptz, updated_at timestamptz,
  worker_confirm_status text, worker_confirmed_at timestamptz
);
-- APPLY_MIGRATION

CREATE FUNCTION pg_temp.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(n::text)::uuid $$;
INSERT INTO public.facility_staff VALUES (pg_temp.uid(1),pg_temp.uid(100),'gig','hourly',15000),(pg_temp.uid(2),pg_temp.uid(100),'gig','daily',100000);
INSERT INTO public.staff_attendances
SELECT pg_temp.uid(n+10),pg_temp.uid(1),pg_temp.uid(100),'2026-10-10'::date + n,'completed',
  '2026-10-10 20:00+09'::timestamptz + n*interval '1 day',
  '2026-10-11 04:00+09'::timestamptz + n*interval '1 day',0
FROM generate_series(1,3) n;

CREATE FUNCTION pg_temp.record_payout(ids uuid[], s integer DEFAULT 1, delta integer DEFAULT 0, tax boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p uuid; r public.facility_staff%ROWTYPE; m integer; d integer; a integer; t integer;
BEGIN
  SELECT * INTO r FROM public.facility_staff WHERE id=pg_temp.uid(s);
  SELECT sum(greatest(0,round(extract(epoch FROM (check_out_at-check_in_at))/60)::integer-greatest(0,coalesce(break_minutes,0)))),count(DISTINCT work_date)
    INTO m,d FROM public.staff_attendances WHERE id=ANY(ids);
  a := CASE r.pay_basis WHEN 'hourly' THEN round(m::numeric*r.pay_rate/60) ELSE d*r.pay_rate END;
  t := CASE WHEN tax THEN floor(a::numeric*0.03/10)*10 ELSE 0 END;
  t := t + floor(t::numeric*0.1/10)*10;
  INSERT INTO public.gig_payouts(facility_id,staff_id,period_start,period_end,covered_until,worked_minutes,worked_days,pay_basis,pay_rate,amount,net_amount,status,attendance_ids,withholding_rate,withholding_amount)
  SELECT r.facility_id,r.id,min(work_date),max(work_date),max(check_out_at),m,d,r.pay_basis,r.pay_rate,a+delta,a+delta-t,'scheduled',ids,CASE WHEN tax THEN 0.033 ELSE 0 END,t
  FROM public.staff_attendances WHERE id=ANY(ids) RETURNING id INTO p;
  RETURN p;
END;
$$;
CREATE FUNCTION pg_temp.must_fail(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN raise_exception THEN
    IF position(expected IN SQLERRM) = 0 THEN RAISE; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected failure: %', command;
END;
$$;

-- A, then B; cancelling A must release A while B stays allocated.
SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(11)]);
SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(12)]);
SELECT pg_temp.must_fail('SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(11),pg_temp.uid(13)])','이미 포함');
UPDATE public.gig_payouts SET status='cancelled' WHERE attendance_ids=ARRAY[pg_temp.uid(11)];
SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(11)]);
SELECT pg_temp.must_fail('SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(12)])','이미 포함');
SELECT pg_temp.must_fail('SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(13)],1,1)','급여 기준');
SELECT pg_temp.must_fail('SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(13),pg_temp.uid(13)])','중복');
SELECT pg_temp.must_fail('SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(13)],2)','근태');
SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(13)],1,0,true);
SELECT pg_temp.must_fail('UPDATE public.gig_payouts SET amount=1 WHERE status=''scheduled''','이미 기록');
UPDATE public.gig_payouts SET status='paid' WHERE status='scheduled';
SELECT pg_temp.must_fail('UPDATE public.gig_payouts SET status=''cancelled'' WHERE status=''paid''','지급 상태');
UPDATE public.gig_payouts SET worker_confirm_status='received',worker_confirmed_at=now() WHERE status='paid';

-- A backdated record with exactly the same checkout as a paid record is distinct.
INSERT INTO public.staff_attendances SELECT pg_temp.uid(14),staff_id,facility_id,work_date,status,check_in_at,check_out_at,30 FROM public.staff_attendances WHERE id=pg_temp.uid(11);
SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(14)]);

-- Two attendance rows on one daily-wage day are not two daily wages.
INSERT INTO public.staff_attendances
SELECT pg_temp.uid(20+n),pg_temp.uid(2),pg_temp.uid(100),'2026-10-13','completed','2026-10-13 09:00+09','2026-10-13 12:00+09',0 FROM generate_series(1,2) n;
SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(21)],2);
SELECT pg_temp.must_fail('SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(22)],2)','일급');
UPDATE public.facility_staff SET pay_basis='monthly' WHERE id=pg_temp.uid(2);
SELECT pg_temp.must_fail('SELECT pg_temp.record_payout(ARRAY[pg_temp.uid(22)],2)','시급·일급');

-- Explicit zero remains zero when checkout completes.
CREATE TRIGGER test_break BEFORE INSERT OR UPDATE ON public.staff_attendances FOR EACH ROW EXECUTE FUNCTION public.fill_staff_attendance_break();
UPDATE public.staff_attendances SET break_minutes=0 WHERE id=pg_temp.uid(14);
DO $$ BEGIN
  IF (SELECT break_minutes FROM public.staff_attendances WHERE id=pg_temp.uid(14)) <> 0 THEN RAISE EXCEPTION 'zero break overwritten'; END IF;
  IF (SELECT count(*) FROM public.gig_payouts WHERE status='paid') <> 3 THEN RAISE EXCEPTION 'payout count mismatch'; END IF;
  IF (SELECT amount FROM public.gig_payouts WHERE status='paid' AND attendance_ids=ARRAY[pg_temp.uid(11)]) <> 120000 THEN RAISE EXCEPTION 'overnight calculation mismatch'; END IF;
END $$;
SELECT 'PASS: ledger overlap, cancellation, recalculation, overnight, tax, daily wage, zero break, immutable snapshots' AS result;
ROLLBACK;
