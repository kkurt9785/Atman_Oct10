BEGIN;
CREATE SCHEMA qa_gig_sites;
GRANT USAGE ON SCHEMA qa_gig_sites TO authenticated;
CREATE TABLE public.profiles(id uuid,role text);
CREATE TABLE public.facilities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),admin_user_id uuid CONSTRAINT facilities_admin_user_id_key UNIQUE,name text,facility_type text,business_registration_number text,address_text text,location public.geography,is_active boolean,approved_at timestamptz,registration_source text,plan_code text,is_demo boolean DEFAULT false,deleted_at timestamptz,contact_phone text,updated_at timestamptz);
CREATE TABLE public.facility_attendance_settings(facility_id uuid PRIMARY KEY,authentication_mode text,gps_radius_meters int,max_gps_accuracy_meters int,qr_fallback_enabled boolean);
CREATE TABLE public.facility_subscriptions(facility_id uuid,plan_code text,status text,billing_cycle text,current_period_start date,current_period_end date,trial_started_at timestamptz,trial_ends_at timestamptz);
CREATE TABLE public.audit_logs(actor_type text,actor_id uuid,action text,entity_type text,entity_id uuid,before_data jsonb,after_data jsonb);
CREATE TABLE public.facility_staff(id uuid,facility_id uuid,worker_id uuid,status text);
CREATE TABLE public.shifts(id uuid,facility_id uuid);
CREATE TABLE public.shift_applications(id uuid,shift_id uuid,worker_id uuid,status text);
CREATE FUNCTION public.current_worker_id() RETURNS uuid LANGUAGE sql AS $$ SELECT auth.uid(); $$;
CREATE FUNCTION public.is_demo_account(p_user uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT p_user='10000000-0000-4000-8000-000000000003'::uuid; $$;
CREATE FUNCTION public.can_manage_facility(p_id uuid,p_roles text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT admin_user_id=auth.uid() FROM public.facilities WHERE id=p_id; $$;
CREATE FUNCTION public.claim_facility_secure(p_facility_id uuid,p_invite_code text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_master_ok boolean:=true;v_facility record; BEGIN SELECT * INTO v_facility FROM public.facilities WHERE id=p_facility_id; IF v_master_ok THEN RETURN p_facility_id; END IF; RETURN NULL; END $$;
INSERT INTO public.profiles VALUES('10000000-0000-4000-8000-000000000001','admin'),('10000000-0000-4000-8000-000000000002','admin'),('10000000-0000-4000-8000-000000000003','admin'),('10000000-0000-4000-8000-000000000004','worker');
-- APPLY_MIGRATION
CREATE FUNCTION pg_temp.reject(p_sql text,p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN IF position(p_expected IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'unexpected success: %',p_sql; END; $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT pg_temp.reject($q$SELECT public.register_gigworker_site('현장A','',127,37,'20000000-0000-4000-8000-000000000001')$q$,'관리자');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT pg_temp.reject($q$SELECT public.register_gigworker_site('현장A','',127,37,'20000000-0000-4000-8000-000000000001')$q$,'시연');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT public.register_gigworker_site('현장A','',127,37,'20000000-0000-4000-8000-000000000001');
SELECT public.register_gigworker_site('현장B',NULL,128,38,'20000000-0000-4000-8000-000000000002');
SELECT public.register_gigworker_site('현장A','',127,37,'20000000-0000-4000-8000-000000000001');
SELECT pg_temp.reject($q$SELECT public.register_gigworker_site('좌표오류','',999,37,'20000000-0000-4000-8000-000000000003')$q$,'위치');
RESET ROLE;
DO $$ DECLARE a uuid;b uuid; BEGIN
  IF (SELECT count(*) FROM public.facilities)<>2 OR (SELECT count(*) FROM public.facility_subscriptions)<>2 OR (SELECT count(*) FROM public.audit_logs)<>2 THEN RAISE EXCEPTION 'creation retry not idempotent'; END IF;
  SELECT id INTO a FROM public.facilities WHERE name='현장A';SELECT id INTO b FROM public.facilities WHERE name='현장B';
  PERFORM public.update_facility_location(a,'현장A','','',127.1,37.1);
  IF (SELECT address_text FROM public.facilities WHERE id=a)<>'위치 기반 근무지' OR (SELECT public.ST_X(location::public.geometry) FROM public.facilities WHERE id=b)<>128 THEN RAISE EXCEPTION 'location scope failure'; END IF;
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  PERFORM pg_temp.reject(format('SELECT public.update_facility_location(%L,''도용'','''','''',127,37)',a),'권한');
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  PERFORM pg_temp.reject(format('SELECT public.claim_facility_secure(%L,''demo'')',a),'실제 사업장');
  INSERT INTO public.facilities(admin_user_id,name,facility_type) VALUES(auth.uid(),'병원','clinic');
  PERFORM pg_temp.reject($q$INSERT INTO public.facilities(admin_user_id,name,facility_type) VALUES(auth.uid(),'병원2','clinic')$q$,'unique');
  INSERT INTO public.facility_staff VALUES('30000000-0000-4000-8000-000000000001',a,'10000000-0000-4000-8000-000000000004','active');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
DO $$ BEGIN
  IF public.get_my_attendance_policy('staff','30000000-0000-4000-8000-000000000001')->>'mode'<>'gps_or_qr' THEN RAISE EXCEPTION 'policy mismatch'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT pg_temp.reject($q$SELECT public.get_my_attendance_policy('staff','30000000-0000-4000-8000-000000000001')$q$,'연결된 근무');
RESET ROLE;
-- A failed audit must roll back all site records.
CREATE FUNCTION public.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.after_data->>'name'='실패현장' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$;
CREATE TRIGGER qa_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.reject_audit();
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.reject($q$SELECT public.register_gigworker_site('실패현장','',127,37,'20000000-0000-4000-8000-000000000009')$q$,'audit failed');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.facilities WHERE name='실패현장') THEN RAISE EXCEPTION 'partial creation'; END IF; END $$;
ROLLBACK;
