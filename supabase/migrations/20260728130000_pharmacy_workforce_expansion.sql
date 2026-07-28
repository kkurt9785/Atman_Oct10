-- Pharmacy workforce expansion: keep one worker/shift/attendance model while
-- separating licensed pharmacists from non-licensed pharmacy office staff.

INSERT INTO public.job_categories (code, name_ko, sector)
VALUES
  ('pharmacist', '약사', 'healthcare'),
  ('pharmacy_staff', '약국 전산·사무직', 'healthcare')
ON CONFLICT (code) DO UPDATE SET name_ko=EXCLUDED.name_ko, sector=EXCLUDED.sector, is_active=true;

ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_role_check;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_required_role_check;
ALTER TABLE public.facility_staff DROP CONSTRAINT IF EXISTS facility_staff_role_check;
ALTER TABLE public.shift_templates DROP CONSTRAINT IF EXISTS shift_templates_required_role_check;
ALTER TABLE public.worker_credentials DROP CONSTRAINT IF EXISTS worker_credentials_credential_type_check;
ALTER TABLE public.worker_credentials DROP CONSTRAINT IF EXISTS worker_credentials_type_check;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass AS table_name
    FROM pg_constraint
    WHERE contype='c'
      AND conrelid IN ('public.workers'::regclass, 'public.shifts'::regclass,
                       'public.facility_staff'::regclass, 'public.shift_templates'::regclass,
                       'public.worker_credentials'::regclass)
      AND (
        pg_get_constraintdef(oid) ILIKE '%role IN%'
        OR pg_get_constraintdef(oid) ILIKE '%credential_type IN%'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.table_name, c.conname);
  END LOOP;
END $$;

ALTER TABLE public.workers
  ADD CONSTRAINT workers_role_check
  CHECK (role IN ('rn','na','pharmacist','pharmacy_staff'));

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_required_role_check
  CHECK (required_role IN ('rn','na','pharmacist','pharmacy_staff','any'));

ALTER TABLE public.facility_staff
  ADD CONSTRAINT facility_staff_role_check
  CHECK (role IN ('rn','na','pharmacist','pharmacy_staff','coordinator','admin','other'));

ALTER TABLE public.shift_templates
  ADD CONSTRAINT shift_templates_required_role_check
  CHECK (required_role IN ('rn','na','pharmacist','pharmacy_staff','any'));

ALTER TABLE public.worker_credentials
  ADD CONSTRAINT worker_credentials_type_check
  CHECK (credential_type IN (
    'nursing_license','na_certificate','pharmacist_license','id_card',
    'health_check','cpr_cert','tuberculosis_test','vaccination','other'
  ));

DO $$
DECLARE
  fn regprocedure;
  def text;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='complete_worker_onboarding'
  ORDER BY p.oid DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'complete_worker_onboarding function not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  def := replace(def,
    'v_worker_role text;',
    'v_worker_role text := (SELECT role FROM public.workers WHERE auth_user_id = auth.uid() AND deleted_at IS NULL);');
  def := replace(def,
    'IF NULLIF(trim(COALESCE(p_license_number, '''')), '''') IS NULL AND p_license_path IS NULL THEN',
    'IF v_worker_role <> ''pharmacy_staff'' AND NULLIF(trim(COALESCE(p_license_number, '''')), '''') IS NULL AND p_license_path IS NULL THEN');
  def := replace(def,
    'IF p_role NOT IN (''rn'',''na'') THEN',
    'IF p_role NOT IN (''rn'',''na'',''pharmacist'',''pharmacy_staff'') THEN');
  def := replace(def,
    'CASE WHEN p_role = ''rn'' THEN ''nursing_license'' ELSE ''na_certificate'' END',
    'CASE p_role WHEN ''rn'' THEN ''nursing_license'' WHEN ''na'' THEN ''na_certificate'' WHEN ''pharmacist'' THEN ''pharmacist_license'' ELSE ''other'' END');
  EXECUTE def;
END $$;

DO $$
DECLARE
  fn regprocedure;
  def text;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='update_my_worker_profile'
  ORDER BY p.oid DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'update_my_worker_profile function not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  def := replace(def,
    'CASE WHEN v_worker_role = ''rn'' THEN ''nursing_license'' ELSE ''na_certificate'' END',
    'CASE v_worker_role WHEN ''rn'' THEN ''nursing_license'' WHEN ''na'' THEN ''na_certificate'' WHEN ''pharmacist'' THEN ''pharmacist_license'' ELSE ''other'' END');
  EXECUTE def;
END $$;

COMMENT ON COLUMN public.workers.role IS
  'rn, na, pharmacist (licensed), pharmacy_staff (non-licensed office/computer support)';

-- Switchable sales demo: one pharmacy, its permanent/contract/office staff and
-- an open substitute-pharmacist shift. The existing master demo invite can claim it.
WITH pharmacy AS (
  INSERT INTO public.facilities (
    name, facility_type, business_registration_number, representative_name,
    address_text, location, contact_name, contact_phone, contact_email,
    is_active, approved_at, is_demo
  ) VALUES (
    '수원 온누리 데모약국', 'pharmacy', 'DEMO-TARGET-PHARMACY',
    '김온누리', '경기 수원시 권선구 권선동',
    public.ST_SetSRID(public.ST_MakePoint(127.0286, 37.2579),4326)::public.geography,
    '김온누리', '010-0000-2001', 'pharmacy-demo@itdot.co.kr',
    true, now(), true
  )
  ON CONFLICT (business_registration_number) DO UPDATE SET
    name=EXCLUDED.name, facility_type='pharmacy', is_active=true,
    approved_at=COALESCE(public.facilities.approved_at,now()), deleted_at=NULL, is_demo=true
  RETURNING id
)
INSERT INTO public.facility_staff (
  facility_id,name,phone,role,department,source,engagement_type,
  contract_start,contract_end,default_start_time,default_end_time,
  default_break_minutes,status,pay_basis,pay_rate,work_weekdays
)
SELECT p.id, v.name, v.phone, v.role, v.department, 'imported', v.engagement,
       v.contract_start, v.contract_end, v.start_time, v.end_time,
       60, 'active', v.pay_basis, v.pay_rate, v.weekdays
FROM pharmacy p
CROSS JOIN (VALUES
  ('김서현 (데모)','DEMO-PHARMACY-01','pharmacist','조제실','regular',
   NULL::date,NULL::date,'09:00'::time,'18:00'::time,'monthly',6200000,ARRAY[1,2,3,4,5]),
  ('이지은 (데모)','DEMO-PHARMACY-02','pharmacist','대체약사','fixed_term',
   current_date-15,current_date+75,'10:00'::time,'19:00'::time,'hourly',35000,ARRAY[2,4,6]),
  ('박하늘 (데모)','DEMO-PHARMACY-03','pharmacy_staff','전산·접수','regular',
   NULL::date,NULL::date,'09:00'::time,'18:00'::time,'monthly',2350000,ARRAY[1,2,3,4,5])
) AS v(name,phone,role,department,engagement,contract_start,contract_end,start_time,end_time,pay_basis,pay_rate,weekdays)
WHERE NOT EXISTS (
  SELECT 1 FROM public.facility_staff s WHERE s.facility_id=p.id AND s.phone=v.phone
);

INSERT INTO public.shifts (
  facility_id,required_role,shift_date,start_time,end_time,hourly_wage,
  estimated_total_pay,description,department,notes,status
)
SELECT f.id,'pharmacist',current_date+1,'09:00','13:00',38000,152000,
       '오전 대체약사 근무 · 처방 조제 및 복약지도','대체약사',
       '약사 면허 확인 후 지원 가능 · 주차 가능','open'
FROM public.facilities f
WHERE f.business_registration_number='DEMO-TARGET-PHARMACY'
  AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.facility_id=f.id AND s.shift_date=current_date+1
      AND s.required_role='pharmacist' AND s.start_time='09:00'
  );

INSERT INTO public.shifts (
  facility_id,required_role,shift_date,start_time,end_time,hourly_wage,
  estimated_total_pay,description,department,notes,status
)
SELECT f.id,'pharmacy_staff',current_date+2,'14:00','18:00',13500,54000,
       '처방전 전산 입력 보조, 서류 및 재고·매대 정리','전산·접수',
       '조제·의약품 판매·복약지도 업무 없음','open'
FROM public.facilities f
WHERE f.business_registration_number='DEMO-TARGET-PHARMACY'
  AND NOT EXISTS (
    SELECT 1 FROM public.shifts s
    WHERE s.facility_id=f.id AND s.shift_date=current_date+2
      AND s.required_role='pharmacy_staff' AND s.start_time='14:00'
  );
