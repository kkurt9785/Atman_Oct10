-- 영업용 비공개 치과 시연 '광교본치과의원' (2026-11-13 사용자 요청)
--
-- · 공개 시연(W여성병원 등)은 그대로 둔다. 이 사업장은 숨은 링크(관리자 앱 /login?demo=dental&key=…)로만 들어간다.
-- · BRN 을 'DEMO-PRIVATE-' 로 시작하게 해 공개 시연 일괄 작업(DEMO-TARGET-*: 매일 시연 근무 50건, 병원 직원 템플릿,
--   근무자 준비 15분 크론)에 섞이지 않게 하고, 관리자 사업장 검색에서도 빼서 다른 관리자에게 이름이 보이지 않게 한다.
-- · 실제 치과 이름이라 직원·근태·대화는 모두 가상의 시연 데이터다. 원장 = 시연 관리자 계정(sales-dental@demo.atman.co.kr,
--   계정 생성은 앱이 첫 로그인 때·매일 아침 되살리기 때 한다).
-- · 치과 구성: 실장 1, 치과위생사 3, 코디네이터 1. 토요일 오전 진료, 수요일 야간 진료(요일별 근무시간).

-- ---------------------------------------------------------------------------
-- ① 사업장 · 출퇴근 설정 · 시연 근무자 2명(앱 연결 직원 — 대화방에 근무자 메시지가 보이려면 필요)
-- ---------------------------------------------------------------------------
INSERT INTO public.facilities (
  name, facility_type, business_registration_number, representative_name,
  address_text, location, contact_name, contact_phone, contact_email,
  is_active, approved_at, is_demo
) VALUES (
  '광교본치과의원', 'small_hospital', 'DEMO-PRIVATE-DENTAL-GWANGGYO', '대표원장',
  '경기 수원시 영통구 광교중앙로',
  public.ST_SetSRID(public.ST_MakePoint(127.0515, 37.2886), 4326)::public.geography,
  '대표원장', '010-0000-2003', 'dental-demo@itdot.co.kr',
  true, now(), true
)
ON CONFLICT (business_registration_number) DO UPDATE SET
  name = EXCLUDED.name, facility_type = 'small_hospital', is_active = true,
  approved_at = COALESCE(public.facilities.approved_at, now()), deleted_at = NULL, is_demo = true;

INSERT INTO public.facility_attendance_settings (facility_id, authentication_mode, gps_radius_meters, max_gps_accuracy_meters)
SELECT id, 'gps_or_qr', 50, 100 FROM public.facilities WHERE business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO'
ON CONFLICT (facility_id) DO NOTHING;

INSERT INTO public.workers (
  kakao_id, name, phone, birth_date, role, verification_status, verified_at,
  experience_years, last_workplace, department_tags, last_active_at, is_demo
) VALUES
  ('demo_dental_1', '정유나', '01090003001', '1996-03-18', 'dental_hygienist', 'approved', now(),
   '6년', '광교본치과의원', ARRAY['스케일링','진료 보조'], now(), true),
  ('demo_dental_2', '오세린', '01090003002', '1998-09-02', 'dental_hygienist', 'approved', now(),
   '3년', '광교본치과의원', ARRAY['스케일링','예방 진료'], now(), true)
ON CONFLICT (kakao_id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, is_demo = true, deleted_at = NULL;

-- ---------------------------------------------------------------------------
-- ② 오늘 근태·대기 중인 반차 — 시연을 열 때마다 '지금' 기준으로 다시 맞춘다(아직 오지 않은 시각은 넣지 않음)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_demo_dental_today()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_f uuid;
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_dow integer := extract(isodow FROM (now() AT TIME ZONE 'Asia/Seoul'))::integer;
  v_n integer := 0;
BEGIN
  SELECT id INTO v_f FROM public.facilities
   WHERE business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO' AND is_demo AND is_active AND deleted_at IS NULL;
  IF v_f IS NULL THEN RETURN 0; END IF;

  -- 오늘 근무하는 직원만, 그날(요일별) 시간으로
  WITH staff AS (
    SELECT s.id, s.phone,
      public.staff_start_time_on(s.default_start_time, s.weekday_hours, v_today) AS st,
      public.staff_end_time_on(s.default_end_time, s.weekday_hours, v_today) AS et,
      s.default_break_minutes
    FROM public.facility_staff s
    WHERE s.facility_id = v_f AND s.phone LIKE 'DEMO-DENTAL-%' AND s.status = 'active'
      AND v_dow = ANY(s.work_weekdays)
  ), shaped AS (
    SELECT st.*,
      ((v_today + st.st) AT TIME ZONE 'Asia/Seoul') AS start_at,
      ((v_today + st.et) AT TIME ZONE 'Asia/Seoul') AS end_at,
      -- 01 8분 일찍 · 02 12분 지각 · 03 3분 일찍 · 04 15분 일찍 · 05 20분 일찍
      CASE right(st.phone, 2) WHEN '01' THEN -8 WHEN '02' THEN 12 WHEN '03' THEN -3 WHEN '04' THEN -15 ELSE -20 END AS in_offset
    FROM staff st
  ), timed AS (
    SELECT s.*, s.start_at + s.in_offset * interval '1 minute' AS in_at, s.end_at + interval '4 minutes' AS out_at
    FROM shaped s
  )
  INSERT INTO public.staff_attendances (
    facility_id, staff_id, work_date, scheduled_start, scheduled_end,
    check_in_at, check_out_at, break_minutes, status, check_in_method, check_out_method,
    check_in_status, check_out_status, late_minutes, note
  )
  SELECT v_f, t.id, v_today, t.st, t.et,
    CASE WHEN t.in_at <= v_now THEN t.in_at END,
    CASE WHEN t.out_at <= v_now THEN t.out_at END,
    t.default_break_minutes,
    CASE WHEN t.out_at <= v_now THEN 'completed'
         WHEN t.in_at <= v_now AND t.in_offset > 0 THEN 'late'
         WHEN t.in_at <= v_now THEN 'working'
         ELSE 'scheduled' END,
    CASE WHEN t.in_at <= v_now THEN 'GPS' END,
    CASE WHEN t.out_at <= v_now THEN 'GPS' END,
    CASE WHEN t.in_at <= v_now THEN 'SUCCESS' END,
    CASE WHEN t.out_at <= v_now THEN 'SUCCESS' END,
    CASE WHEN t.in_offset > 0 AND t.in_at <= v_now THEN t.in_offset ELSE 0 END,
    '시연 근태'
  FROM timed t
  ON CONFLICT (staff_id, work_date) DO UPDATE SET
    scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
    check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at,
    break_minutes = EXCLUDED.break_minutes, status = EXCLUDED.status,
    check_in_method = EXCLUDED.check_in_method, check_out_method = EXCLUDED.check_out_method,
    check_in_status = EXCLUDED.check_in_status, check_out_status = EXCLUDED.check_out_status,
    late_minutes = EXCLUDED.late_minutes, checkout_requested_at = NULL, missing_checkout_at = NULL,
    note = EXCLUDED.note, updated_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- 대기 중인 반차 1건: 오세린(02) 다음 근무일 오후 반차 — 대화방 메시지와 맞춘다
  DELETE FROM public.staff_leave_requests
   WHERE facility_id = v_f AND status = 'pending'
     AND staff_id IN (SELECT id FROM public.facility_staff WHERE facility_id = v_f AND phone LIKE 'DEMO-DENTAL-%');
  INSERT INTO public.staff_leave_requests (
    facility_id, staff_id, leave_type, half_day_period, start_date, end_date, requested_minutes, reason, status
  )
  SELECT v_f, s.id, 'half_day', 'pm', d, d, 240, '치과 진료 예약(본인)', 'pending'
  FROM public.facility_staff s
  CROSS JOIN LATERAL (
    SELECT min(x)::date AS d FROM generate_series(v_today + 1, v_today + 7, interval '1 day') x
    WHERE extract(isodow FROM x)::integer = ANY(s.work_weekdays)
  ) nx
  WHERE s.facility_id = v_f AND s.phone = 'DEMO-DENTAL-02' AND nx.d IS NOT NULL;

  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_demo_dental_today() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_demo_dental_today() TO service_role;

-- ---------------------------------------------------------------------------
-- ③ 지난달 1일 ~ 어제 근태 기록 (근태 기록·월 요약·급여 예상 화면용)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_demo_dental_month_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_f uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_start date := (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month')::date;
  v_n integer := 0;
BEGIN
  SELECT id INTO v_f FROM public.facilities
   WHERE business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO' AND is_demo AND is_active AND deleted_at IS NULL;
  IF v_f IS NULL THEN RETURN 0; END IF;

  WITH days AS (
    SELECT s.id, s.phone, s.default_break_minutes, d::date AS work_date,
      public.staff_start_time_on(s.default_start_time, s.weekday_hours, d::date) AS st,
      public.staff_end_time_on(s.default_end_time, s.weekday_hours, d::date) AS et,
      row_number() OVER (PARTITION BY s.id ORDER BY d) AS seq
    FROM public.facility_staff s
    CROSS JOIN generate_series(v_start, v_today - 1, interval '1 day') d
    WHERE s.facility_id = v_f AND s.phone LIKE 'DEMO-DENTAL-%' AND s.status = 'active'
      AND extract(isodow FROM d)::integer = ANY(s.work_weekdays)
  ), shaped AS (
    SELECT d.*,
      CASE WHEN right(d.phone, 2) = '01' AND d.seq IN (9, 31) THEN 'leave' ELSE 'completed' END AS att_status,
      CASE WHEN right(d.phone, 2) = '02' AND d.seq IN (4, 17, 33) THEN 9 ELSE 0 END AS late_value,
      CASE WHEN right(d.phone, 2) = '03' AND d.seq = 6 THEN 30 ELSE 0 END AS early_value
    FROM days d
  )
  INSERT INTO public.staff_attendances (
    facility_id, staff_id, work_date, scheduled_start, scheduled_end,
    check_in_at, check_out_at, break_minutes, status, check_in_method, check_out_method,
    check_in_status, check_out_status, late_minutes, early_leave_minutes, note
  )
  SELECT v_f, s.id, s.work_date, s.st, s.et,
    CASE WHEN s.att_status = 'leave' THEN NULL ELSE
      ((s.work_date + s.st) AT TIME ZONE 'Asia/Seoul')
      + CASE WHEN s.late_value > 0 THEN s.late_value * interval '1 minute' ELSE interval '-6 minutes' END END,
    CASE WHEN s.att_status = 'leave' THEN NULL ELSE
      ((s.work_date + s.et) AT TIME ZONE 'Asia/Seoul') - s.early_value * interval '1 minute' + interval '4 minutes' END,
    CASE WHEN s.et - s.st >= interval '8 hours' THEN s.default_break_minutes ELSE 0 END,
    s.att_status,
    CASE WHEN s.att_status = 'leave' THEN NULL WHEN s.seq % 7 = 0 THEN 'QR_FALLBACK' ELSE 'GPS' END,
    CASE WHEN s.att_status = 'leave' THEN NULL WHEN s.seq % 7 = 0 THEN 'QR_FALLBACK' ELSE 'GPS' END,
    CASE WHEN s.att_status = 'leave' THEN NULL ELSE 'SUCCESS' END,
    CASE WHEN s.att_status = 'leave' THEN NULL ELSE 'SUCCESS' END,
    s.late_value, s.early_value,
    CASE WHEN s.att_status = 'leave' THEN '승인 연차' WHEN s.late_value > 0 THEN '지각'
         WHEN s.early_value > 0 THEN '조퇴' ELSE '정상 근무' END
  FROM shaped s
  ON CONFLICT (staff_id, work_date) DO UPDATE SET
    scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
    check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at,
    break_minutes = EXCLUDED.break_minutes, status = EXCLUDED.status,
    check_in_method = EXCLUDED.check_in_method, check_out_method = EXCLUDED.check_out_method,
    check_in_status = EXCLUDED.check_in_status, check_out_status = EXCLUDED.check_out_status,
    late_minutes = EXCLUDED.late_minutes, early_leave_minutes = EXCLUDED.early_leave_minutes,
    checkout_requested_at = NULL, missing_checkout_at = NULL, note = EXCLUDED.note, updated_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_demo_dental_month_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_demo_dental_month_history() TO service_role;

-- ---------------------------------------------------------------------------
-- ④ 직원 5명 다시 만들기(매일 아침 되살리기) → 연차 → 지난달·오늘 근태
-- ---------------------------------------------------------------------------
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
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_sat jsonb := '{"6":{"start":"09:30","end":"14:00"}}'::jsonb;
  v_wed jsonb := '{"3":{"start":"12:00","end":"21:00"},"6":{"start":"09:30","end":"14:00"}}'::jsonb;
BEGIN
  SELECT id INTO v_f FROM public.facilities
   WHERE business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO' AND is_demo AND is_active AND deleted_at IS NULL;
  IF v_f IS NULL THEN RAISE EXCEPTION 'private dental demo facility not found'; END IF;
  SELECT id INTO v_w1 FROM public.workers WHERE kakao_id = 'demo_dental_1' AND is_demo AND deleted_at IS NULL;
  SELECT id INTO v_w2 FROM public.workers WHERE kakao_id = 'demo_dental_2' AND is_demo AND deleted_at IS NULL;

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
    (v_f, NULL, '문가을', 'DEMO-DENTAL-03', 'dental_hygienist', '진료실', 'imported', 'fixed_term',
     v_today - 45, v_today + 135, '09:30', '18:30', 60, 'active', 'hourly', 16000, ARRAY[2,3,4,5,6]::smallint[], v_sat),
    (v_f, NULL, '한소율', 'DEMO-DENTAL-04', 'coordinator', '데스크', 'imported', 'regular',
     NULL, NULL, '09:00', '18:00', 60, 'active', 'monthly', 2600000, ARRAY[1,2,3,4,5,6]::smallint[], '{"6":{"start":"09:00","end":"14:00"}}'::jsonb),
    (v_f, NULL, '김은정', 'DEMO-DENTAL-05', 'admin', '실장', 'imported', 'regular',
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

-- ---------------------------------------------------------------------------
-- ⑤ 대화방: 치과 말투(원장)로 공지·1:1 대화·출석 확인, 시연 로그인·되살리기 목록에 이 사업장 추가
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.patch_once(def text, old text, new text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE hits integer := (length(def) - length(replace(def, old, ''))) / length(old);
BEGIN
  IF hits <> 1 THEN RAISE EXCEPTION 'dental demo patch: expected 1 match, found % for: %', hits, left(old, 80); END IF;
  RETURN replace(def, old, new);
END $fn$;

DO $workroom$
DECLARE
  fn regprocedure := to_regprocedure('public.seed_demo_workroom(uuid)');
  def text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'seed_demo_workroom not found'; END IF;
  def := pg_get_functiondef(fn);
  IF position('''dental''' in def) > 0 THEN RAISE NOTICE 'seed_demo_workroom: dental already patched'; RETURN; END IF;
  def := pg_temp.patch_once(def,
    $o$    WHEN v_f.business_registration_number = 'DEMO-GIGWORKER-2026' THEN 'gig'$o$,
    $n$    WHEN v_f.business_registration_number = 'DEMO-GIGWORKER-2026' THEN 'gig'
    WHEN v_f.business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO' THEN 'dental'$n$);
  def := pg_temp.patch_once(def,
    $o$WHEN 'care' THEN '수간호사' ELSE '원무과 실장' END;$o$,
    $n$WHEN 'care' THEN '수간호사' WHEN 'dental' THEN '원장' ELSE '원무과 실장' END;$n$);
  def := pg_temp.patch_once(def,
    $o$    -- 단기 (팝업스토어)$o$,
    $n$    -- 치과 (영업용 비공개 시연)
    ('dental', 1, 'room', 'admin', 'announcement', '[공지] 다음 주부터 수요일은 야간 진료(밤 9시까지)예요. 수요일 근무하시는 분은 근무표에서 시간을 확인해 주세요.', 1560),
    ('dental', 2, 'room', 'admin', 'announcement', '이번 달 급여명세서는 10일에 앱에서 볼 수 있어요. 연차는 쓰기 3일 전까지 앱으로 신청해 주세요.', 1500),
    ('dental', 3, 'a', 'admin', 'message', '{a} 선생님, 이번 주 토요일 스케일링 예약이 많아요. 9시 20분까지 와 줄 수 있어요?', 180),
    ('dental', 4, 'a', 'a', 'message', '네 원장님, 9시 20분까지 갈게요.', 170),
    ('dental', 5, 'a', 'admin', 'message', '고마워요! 근무표에 넣어 둘게요.', 165),
    ('dental', 6, 'b', 'b', 'message', '원장님, 다음 근무일 오후에 제 치과 진료 예약이 있어서 반차 신청 올렸어요.', 30),
    ('dental', 7, 'b', 'b', 'message', '확인 부탁드려요!', 24),
    -- 단기 (팝업스토어)$n$);
  def := pg_temp.patch_once(def,
    $o$    WHEN 'pharmacy' THEN '이번 주 토요일 오전 근무(9시~13시) 나올 수 있으면 확인을 눌러 주세요.'$o$,
    $n$    WHEN 'pharmacy' THEN '이번 주 토요일 오전 근무(9시~13시) 나올 수 있으면 확인을 눌러 주세요.'
    WHEN 'dental' THEN '다음 주 화요일 점심시간 감염관리 교육(진료실)에 참석할 수 있으면 확인을 눌러 주세요.'$n$);
  EXECUTE def;
END $workroom$;

DO $lists$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN SELECT unnest(ARRAY['public.seed_demo_workrooms()', 'public.seed_demo_workrooms_for(uuid)']) AS sig LOOP
    IF to_regprocedure(r.sig) IS NULL THEN RAISE EXCEPTION '% not found', r.sig; END IF;
    def := pg_get_functiondef(to_regprocedure(r.sig));
    IF position('DEMO-PRIVATE-DENTAL-GWANGGYO' in def) > 0 THEN CONTINUE; END IF;
    def := pg_temp.patch_once(def,
      $o$IN ('DEMO-TARGET-PHARMACY', 'DEMO-GIGWORKER-2026')$o$,
      $n$IN ('DEMO-TARGET-PHARMACY', 'DEMO-GIGWORKER-2026', 'DEMO-PRIVATE-DENTAL-GWANGGYO')$n$);
    EXECUTE def;
  END LOOP;
END $lists$;

-- ---------------------------------------------------------------------------
-- ⑥ 관리자 사업장 검색에서 비공개 시연(DEMO-PRIVATE-*) 숨기기
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_claimable_facilities(p_query text)
RETURNS TABLE (
  id uuid,
  name text,
  facility_type text,
  address_text text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.id, f.name, f.facility_type, f.address_text
  FROM public.facilities AS f
  JOIN public.profiles AS p ON p.id = auth.uid() AND p.role = 'admin'
  WHERE length(regexp_replace(trim(p_query), '\s+', '', 'g')) >= 2
    AND regexp_replace(f.name, '\s+', '', 'g')
        ILIKE '%' || regexp_replace(trim(p_query), '\s+', '', 'g') || '%'
    AND f.is_active = true
    AND f.deleted_at IS NULL
    -- 영업용 비공개 시연은 이름이 실제 사업장이라 검색에 내보내지 않는다(2026-11-13)
    AND COALESCE(f.business_registration_number, '') NOT LIKE 'DEMO-PRIVATE-%'
    AND (
      f.is_demo = true
      OR (
        f.admin_user_id IS NULL
        AND f.invite_code_hash IS NOT NULL
        AND (f.invite_code_expires_at IS NULL OR f.invite_code_expires_at > now())
      )
    )
  ORDER BY f.is_demo DESC, f.name
  LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.search_claimable_facilities(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_claimable_facilities(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 지금 한 번 채우고 확인
-- ---------------------------------------------------------------------------
SELECT * FROM public.refresh_demo_dental_workforce();
-- 시연 사업장 요금제(최상위 플랜) — 매일 되살리기도 하지만 첫 시연이 그 전에 열릴 수 있다
SELECT public.ensure_demo_subscriptions();

DO $verify$
DECLARE v_f uuid; v_staff integer; v_linked integer;
BEGIN
  SELECT id INTO v_f FROM public.facilities WHERE business_registration_number = 'DEMO-PRIVATE-DENTAL-GWANGGYO' AND is_demo;
  IF v_f IS NULL THEN RAISE EXCEPTION '치과 시연 사업장 생성 실패'; END IF;
  SELECT count(*), count(worker_id) INTO v_staff, v_linked FROM public.facility_staff WHERE facility_id = v_f AND phone LIKE 'DEMO-DENTAL-%';
  IF v_staff <> 5 OR v_linked <> 2 THEN RAISE EXCEPTION '치과 시연 직원 % 명(연결 %) — 5명·연결 2명이어야 함', v_staff, v_linked; END IF;
  IF position('''dental''' in pg_get_functiondef('public.seed_demo_workroom(uuid)'::regprocedure)) = 0 THEN RAISE EXCEPTION '대화방 치과 패치 실패'; END IF;
  IF position('DEMO-PRIVATE-%' in pg_get_functiondef('public.search_claimable_facilities(text)'::regprocedure)) = 0 THEN RAISE EXCEPTION '검색 숨김 실패'; END IF;
  RAISE NOTICE '광교본치과의원 비공개 시연 준비 완료';
END $verify$;
