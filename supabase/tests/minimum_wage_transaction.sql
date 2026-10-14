-- Isolated schema; all DDL and records rolled back. Full migration is injected.
BEGIN;
CREATE SCHEMA qa_minimum_wage;
CREATE TABLE public.shifts(id integer,status text DEFAULT 'open',shift_date date,start_time time,end_time time,hourly_wage numeric,notes text);
CREATE TABLE public.gig_projects(id integer,status text DEFAULT 'active',starts_on date,ends_on date,start_time time,end_time time,pay_basis text DEFAULT 'hourly',pay_rate numeric);
CREATE TABLE public.facility_staff(id integer,status text DEFAULT 'active',contract_start date,contract_end date,pay_basis text DEFAULT 'hourly',pay_rate numeric);
CREATE TABLE public.shift_templates(hourly_wage numeric);
CREATE TABLE public.staffing_requirements(replacement_hourly_wage numeric);
INSERT INTO public.shifts VALUES(99,'completed','2025-01-01','09:00','17:00',8000,'historical');
-- APPLY_MIGRATION
CREATE FUNCTION pg_temp.reject(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
    IF position(expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE;
  END;
  RAISE EXCEPTION 'Unexpected success: %',command;
END $$;
INSERT INTO public.shifts(id,shift_date,start_time,end_time,hourly_wage) VALUES(1,'2026-12-30','09:00','17:00',10320),(2,'2027-01-01','09:00','17:00',10700);
SELECT pg_temp.reject($q$INSERT INTO public.shifts(id,shift_date,start_time,end_time,hourly_wage) VALUES(3,'2027-01-01','09:00','17:00',10320)$q$,'10700');
SELECT pg_temp.reject($q$INSERT INTO public.shifts(id,shift_date,start_time,end_time,hourly_wage) VALUES(4,'2026-12-31','22:00','06:00',10320)$q$,'10700');
SELECT pg_temp.reject($q$INSERT INTO public.shifts(id,shift_date,start_time,end_time,hourly_wage) VALUES(5,'2028-01-01','09:00','17:00',99999)$q$,'등록되지');
SELECT pg_temp.reject($q$UPDATE public.shifts SET shift_date='2027-01-01' WHERE id=1$q$,'10700');
INSERT INTO public.shifts(id,status,shift_date,start_time,end_time,hourly_wage) VALUES(6,'cancelled','2027-01-01','09:00','17:00',10000);
SELECT pg_temp.reject($q$UPDATE public.shifts SET status='open' WHERE id=6$q$,'10700');
UPDATE public.shifts SET notes='preserve historical amount' WHERE id=99;
INSERT INTO public.gig_projects(id,starts_on,ends_on,start_time,end_time,pay_rate) VALUES(1,'2026-12-30','2027-01-02','09:00','17:00',10700);
SELECT pg_temp.reject($q$INSERT INTO public.gig_projects(id,starts_on,ends_on,start_time,end_time,pay_rate) VALUES(2,'2026-12-30','2027-01-02','09:00','17:00',10320)$q$,'10700');
SELECT pg_temp.reject($q$INSERT INTO public.facility_staff(id,contract_start,contract_end,pay_rate) VALUES(1,'2027-01-01','2027-01-31',10320)$q$,'10700');
INSERT INTO public.facility_staff(id,contract_start,contract_end,pay_rate) VALUES(2,'2027-01-01','2027-01-31',10700);
SELECT pg_temp.reject($q$INSERT INTO public.shift_templates VALUES(1)$q$,'시급');
SELECT pg_temp.reject($q$INSERT INTO public.staffing_requirements VALUES(1)$q$,'시급');
DO $$ BEGIN
  IF (SELECT hourly_wage FROM public.shifts WHERE id=99) <> 8000 THEN RAISE EXCEPTION 'historical wage changed'; END IF;
END $$;
SELECT 'PASS: year boundary, overnight, multi-year period, unknown year, direct writes, reactivation, history preservation' AS result;
ROLLBACK;
