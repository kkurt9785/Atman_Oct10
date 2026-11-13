-- 비공개 치과 시연 다듬기 (2026-11-13 운영 확인 뒤, 미팅 전)
-- ① 홈 '사업장 총원을 먼저 입력해 주세요' 대신 인력 현황이 보이게 총원 5명(원장 = 시연 관리자 제외)
-- ② 대화 탭에서 김은정·문가을·한소율이 '수락 전'으로 흐리게 보이던 것 — 다섯 명 모두 근무자 앱에 연결
-- ③ 요금제가 Pro 169,000원으로 보이던 것 — 치과의원이 실제로 쓸 Clinic(병원·의원 69,000원)으로.
--    ensure_demo_subscriptions 가 매일 시연 사업장을 Pro 로 되돌리므로 이 사업장만 'clinic' 으로 예외를 둔다.

UPDATE public.facilities SET employee_count = 5
 WHERE business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO' AND is_demo;

INSERT INTO public.workers (
  kakao_id, name, phone, birth_date, role, verification_status, verified_at,
  experience_years, last_workplace, department_tags, last_active_at, is_demo
) VALUES
  ('demo_dental_3', '문가을', '01090003003', '2000-05-27', 'dental_hygienist', 'approved', now(),
   '1년', '광교본치과의원', ARRAY['진료 보조'], now(), true),
  ('demo_dental_4', '한소율', '01090003004', '1997-12-08', 'other', 'approved', now(),
   '4년', '광교본치과의원', ARRAY['예약·수납'], now(), true),
  ('demo_dental_5', '김은정', '01090003005', '1988-07-21', 'other', 'approved', now(),
   '12년', '광교본치과의원', ARRAY['실장','보험 청구'], now(), true)
ON CONFLICT (kakao_id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, is_demo = true, deleted_at = NULL;

CREATE OR REPLACE FUNCTION public.refresh_demo_dental_workforce()
RETURNS TABLE(kind text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_f uuid;
  v_w1 uuid;
  v_w2 uuid;
  v_w3 uuid;
  v_w4 uuid;
  v_w5 uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_sat jsonb := '{"6":{"start":"09:30","end":"14:00"}}'::jsonb;
  v_wed jsonb := '{"3":{"start":"12:00","end":"21:00"},"6":{"start":"09:30","end":"14:00"}}'::jsonb;
BEGIN
  SELECT id INTO v_f FROM public.facilities
   WHERE business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO' AND is_demo AND is_active AND deleted_at IS NULL;
  IF v_f IS NULL THEN RAISE EXCEPTION 'private dental demo facility not found'; END IF;
  SELECT id INTO v_w1 FROM public.workers WHERE kakao_id = 'demo_dental_1' AND is_demo AND deleted_at IS NULL;
  SELECT id INTO v_w2 FROM public.workers WHERE kakao_id = 'demo_dental_2' AND is_demo AND deleted_at IS NULL;
  SELECT id INTO v_w3 FROM public.workers WHERE kakao_id = 'demo_dental_3' AND is_demo AND deleted_at IS NULL;
  SELECT id INTO v_w4 FROM public.workers WHERE kakao_id = 'demo_dental_4' AND is_demo AND deleted_at IS NULL;
  SELECT id INTO v_w5 FROM public.workers WHERE kakao_id = 'demo_dental_5' AND is_demo AND deleted_at IS NULL;

  -- 방문자가 고친 근태 이력(수정 이력은 근태 삭제를 막는다)부터 지우고 시연 직원 전체 재생성(자식행 CASCADE)
  DELETE FROM public.staff_attendance_change_logs
   WHERE facility_id = v_f AND attendance_id IN (
     SELECT a.id FROM public.staff_attendances a JOIN public.facility_staff s ON s.id = a.staff_id
      WHERE s.facility_id = v_f AND s.phone LIKE 'DEMO-%');
  DELETE FROM public.facility_staff WHERE facility_id = v_f AND phone LIKE 'DEMO-%';

  INSERT INTO public.facility_staff (
    facility_id, worker_id, name, phone, role, department, source, engagement_type,
    contract_start, contract_end, default_start_time, default_end_time, default_break_minutes,
    status, pay_basis, pay_rate, work_weekdays, weekday_hours
  ) VALUES
    (v_f, v_w1, '정유나', 'DEMO-DENTAL-01', 'dental_hygienist', '진료실',
     CASE WHEN v_w1 IS NULL THEN 'imported' ELSE 'atman' END, 'regular',
     NULL, NULL, '09:30', '18:30', 60, 'active', 'monthly', 3100000, ARRAY[1,2,3,4,5,6]::smallint[], v_sat),
    (v_f, v_w2, '오세린', 'DEMO-DENTAL-02', 'dental_hygienist', '진료실',
     CASE WHEN v_w2 IS NULL THEN 'imported' ELSE 'atman' END, 'regular',
     NULL, NULL, '09:30', '18:30', 60, 'active', 'monthly', 2900000, ARRAY[1,2,3,4,5,6]::smallint[], v_wed),
    (v_f, v_w3, '문가을', 'DEMO-DENTAL-03', 'dental_hygienist', '진료실', CASE WHEN v_w3 IS NULL THEN 'imported' ELSE 'atman' END, 'fixed_term',
     v_today - 45, v_today + 135, '09:30', '18:30', 60, 'active', 'hourly', 16000, ARRAY[2,3,4,5,6]::smallint[], v_sat),
    (v_f, v_w4, '한소율', 'DEMO-DENTAL-04', 'coordinator', '데스크', CASE WHEN v_w4 IS NULL THEN 'imported' ELSE 'atman' END, 'regular',
     NULL, NULL, '09:00', '18:00', 60, 'active', 'monthly', 2600000, ARRAY[1,2,3,4,5,6]::smallint[], '{"6":{"start":"09:00","end":"14:00"}}'::jsonb),
    (v_f, v_w5, '김은정', 'DEMO-DENTAL-05', 'admin', '실장', CASE WHEN v_w5 IS NULL THEN 'imported' ELSE 'atman' END, 'regular',
     NULL, NULL, '09:00', '18:00', 60, 'active', 'monthly', 3600000, ARRAY[1,2,3,4,5]::smallint[], '{}'::jsonb);

  -- 연차 15일(8시간 기준 7,200분), 사람마다 쓴 만큼
  INSERT INTO public.staff_leave_balances (facility_id, staff_id, leave_year, granted_minutes, used_minutes, note)
  SELECT v_f, s.id, extract(year FROM v_today)::integer, 7200,
    CASE right(s.phone, 2) WHEN '01' THEN 1920 WHEN '02' THEN 480 WHEN '05' THEN 2400 ELSE 0 END, '연차 부여'
  FROM public.facility_staff s WHERE s.facility_id = v_f AND s.phone LIKE 'DEMO-DENTAL-%'
  ON CONFLICT (staff_id, leave_year) DO UPDATE SET
    granted_minutes = EXCLUDED.granted_minutes, used_minutes = EXCLUDED.used_minutes,
    note = EXCLUDED.note, updated_at = now();

  INSERT INTO public.facility_attendance_qr (facility_id, is_active)
  VALUES (v_f, true)
  ON CONFLICT (facility_id) DO UPDATE SET is_active = true;

  PERFORM public.refresh_demo_dental_month_history();
  PERFORM public.refresh_demo_dental_today();

  RETURN QUERY
  SELECT 'dental_staff'::text, count(*) FROM public.facility_staff WHERE facility_id = v_f AND phone LIKE 'DEMO-DENTAL-%'
  UNION ALL
  SELECT 'linked_staff', count(*) FROM public.facility_staff WHERE facility_id = v_f AND phone LIKE 'DEMO-DENTAL-%' AND worker_id IS NOT NULL
  UNION ALL
  SELECT 'attendance_rows', count(*) FROM public.staff_attendances WHERE facility_id = v_f
  UNION ALL
  SELECT 'pending_leave', count(*) FROM public.staff_leave_requests WHERE facility_id = v_f AND status = 'pending';
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_demo_dental_workforce() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_demo_dental_workforce() TO service_role;

DO $plan$
DECLARE
  fn regprocedure := to_regprocedure('public.ensure_demo_subscriptions()');
  def text;
  old text := $o$CASE WHEN f.facility_type = 'pharmacy' THEN 'pharmacy_plus' ELSE 'pro' END$o$;
  new text := $n$CASE WHEN f.facility_type = 'pharmacy' THEN 'pharmacy_plus' WHEN f.business_registration_number LIKE 'DEMO-PRIVATE-DENTAL-%' THEN 'clinic' ELSE 'pro' END$n$;
  hits integer;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'ensure_demo_subscriptions not found'; END IF;
  def := pg_get_functiondef(fn);
  IF position('DEMO-PRIVATE-DENTAL-' in def) > 0 THEN RETURN; END IF;
  hits := (length(def) - length(replace(def, old, ''))) / length(old);
  IF hits <> 2 THEN RAISE EXCEPTION 'ensure_demo_subscriptions: 요금제 지정 자리 % 곳(2곳이어야 함)', hits; END IF;
  EXECUTE replace(def, old, new);
END $plan$;

SELECT public.ensure_demo_subscriptions();
SELECT * FROM public.refresh_demo_dental_workforce();

DO $verify$
DECLARE v_f uuid; v_linked integer; v_plan text;
BEGIN
  SELECT id INTO v_f FROM public.facilities WHERE business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO' AND is_demo;
  SELECT count(worker_id) INTO v_linked FROM public.facility_staff WHERE facility_id = v_f AND phone LIKE 'DEMO-DENTAL-%';
  IF v_linked <> 5 THEN RAISE EXCEPTION '앱 연결 직원 %명(5명이어야 함)', v_linked; END IF;
  SELECT plan_code INTO v_plan FROM public.facility_subscriptions WHERE facility_id = v_f AND status = 'active' ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_plan IS DISTINCT FROM 'clinic' THEN RAISE EXCEPTION '치과 시연 요금제 % (clinic 이어야 함)', v_plan; END IF;
  RAISE NOTICE '치과 시연 다듬기 완료';
END $verify$;
