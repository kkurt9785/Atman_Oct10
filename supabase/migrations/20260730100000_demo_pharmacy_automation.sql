-- ============================================================================
-- 데모 약국 가동 (2026-07-30)
--   ① 클리닉 데모 cron 스코프 수정 — DEMO-TARGET-% 가 약국까지 잡아 간호사
--      직원이 약국에 시드되던 오염 차단 (facility_type <> 'pharmacy')
--   ② 약국 전용 refresh_demo_pharmacy_workforce() — 약사·전산사무 직원 3명,
--      오늘 근태(근무중·완료·지각), 휴가, QR, 대체약사 공고 + 데모약사 지원 재생성
--   ③ 매일 00:12 KST pg_cron 등록 + 즉시 1회 실행
--   ④ 데모 약국 plan_code = 'pharmacy' (요금제 화면 시연)
-- 사전 조건: kakao_id 'demo_pharmacist_1' 데모 약사 워커(Kurt가 REST로 생성)
--   — 없어도 동작(직원 연결·지원만 생략)
-- ============================================================================

-- ① 클리닉 데모 함수에서 약국 제외
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.refresh_demo_clinic_workforce()');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'refresh_demo_clinic_workforce not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%facility_type <> ''pharmacy''%' THEN
    RAISE NOTICE 'patch ① skipped: already pharmacy-excluded'; RETURN;
  END IF;

  patched := replace(def,
    'WHERE is_demo = true AND business_registration_number LIKE ''DEMO-TARGET-%''',
    'WHERE is_demo = true AND business_registration_number LIKE ''DEMO-TARGET-%'' AND facility_type <> ''pharmacy''');
  IF patched = def THEN RAISE EXCEPTION 'patch ①-1 no-op: DELETE scope not found'; END IF;
  def := patched;

  patched := replace(def,
    'WHERE is_demo = true
      AND business_registration_number LIKE ''DEMO-TARGET-%''',
    'WHERE is_demo = true
      AND business_registration_number LIKE ''DEMO-TARGET-%''
      AND facility_type <> ''pharmacy''');
  IF patched = def THEN RAISE EXCEPTION 'patch ①-2 no-op: ranked_facilities scope not found'; END IF;

  EXECUTE patched;
END $$;

-- ②③④를 위한 약국 전용 리프레시 함수
CREATE OR REPLACE FUNCTION public.refresh_demo_pharmacy_workforce()
RETURNS TABLE(kind text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_ph uuid;
  v_worker uuid;
  v_shift uuid;
BEGIN
  SELECT id INTO v_ph FROM public.facilities
  WHERE is_demo = true AND business_registration_number = 'DEMO-TARGET-PHARMACY'
    AND is_active = true AND deleted_at IS NULL;
  IF v_ph IS NULL THEN RAISE EXCEPTION 'demo pharmacy (DEMO-TARGET-PHARMACY) not found'; END IF;

  SELECT id INTO v_worker FROM public.workers
  WHERE is_demo = true AND kakao_id = 'demo_pharmacist_1' AND deleted_at IS NULL;

  -- 데모 시드 직원 전체 재생성 (병원 직군 오염분 DEMO-WF-% 포함 제거, 자식행 CASCADE)
  DELETE FROM public.facility_staff WHERE facility_id = v_ph AND phone LIKE 'DEMO-%';

  INSERT INTO public.facility_staff (
    facility_id, worker_id, name, phone, role, department, source, engagement_type,
    contract_start, contract_end, default_start_time, default_end_time,
    default_break_minutes, status, pay_basis, pay_rate, work_weekdays
  ) VALUES
    (v_ph, v_worker, '김서현 (데모)', 'DEMO-PHARMACY-01', 'pharmacist', '조제실',
     CASE WHEN v_worker IS NULL THEN 'imported' ELSE 'atman' END, 'regular',
     NULL, NULL, '09:00', '18:00', 60, 'active', 'monthly', 4200000, ARRAY[1,2,3,4,5]::smallint[]),
    (v_ph, NULL, '이지은 (데모)', 'DEMO-PHARMACY-02', 'pharmacist', '대체약사', 'imported', 'fixed_term',
     v_today - 30, v_today + 60, '09:00', '13:00', 0, 'active', 'hourly', 38000, ARRAY[6]::smallint[]),
    (v_ph, NULL, '박하늘 (데모)', 'DEMO-PHARMACY-03', 'pharmacy_staff', '전산·접수', 'imported', 'regular',
     NULL, NULL, '09:00', '18:00', 60, 'active', 'monthly', 2400000, ARRAY[1,2,3,4,5]::smallint[]);

  INSERT INTO public.staff_leave_balances (facility_id, staff_id, leave_year, granted_minutes, used_minutes, note)
  SELECT facility_id, id, extract(year from v_today)::integer, 7200,
         CASE WHEN phone LIKE '%-01' THEN 960 ELSE 0 END, '데모: 연차 부여'
  FROM public.facility_staff WHERE facility_id = v_ph AND phone LIKE 'DEMO-PHARMACY-%'
  ON CONFLICT (staff_id, leave_year) DO UPDATE SET
    granted_minutes = EXCLUDED.granted_minutes, used_minutes = EXCLUDED.used_minutes,
    note = EXCLUDED.note, updated_at = now();

  -- 오늘 근태: 01 정상 근무중 / 02 완료(대체약사 오전) / 03 지각 근무중
  INSERT INTO public.staff_attendances (
    facility_id, staff_id, work_date, scheduled_start, scheduled_end,
    check_in_at, check_out_at, break_minutes, status, late_minutes, note
  )
  SELECT facility_id, id, v_today, default_start_time, default_end_time,
    CASE
      WHEN phone LIKE '%-01' THEN (v_today + time '08:55') AT TIME ZONE 'Asia/Seoul'
      WHEN phone LIKE '%-02' THEN (v_today + time '08:58') AT TIME ZONE 'Asia/Seoul'
      WHEN phone LIKE '%-03' THEN (v_today + time '09:12') AT TIME ZONE 'Asia/Seoul'
    END,
    CASE WHEN phone LIKE '%-02' THEN (v_today + time '13:02') AT TIME ZONE 'Asia/Seoul' END,
    default_break_minutes,
    CASE
      WHEN phone LIKE '%-01' THEN 'working'
      WHEN phone LIKE '%-02' THEN 'completed'
      WHEN phone LIKE '%-03' THEN 'late'
    END,
    CASE WHEN phone LIKE '%-03' THEN 12 ELSE 0 END,
    '데모: 약국 근태'
  FROM public.facility_staff WHERE facility_id = v_ph AND phone LIKE 'DEMO-PHARMACY-%'
  ON CONFLICT (staff_id, work_date) DO UPDATE SET
    scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
    check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at,
    break_minutes = EXCLUDED.break_minutes, status = EXCLUDED.status,
    late_minutes = EXCLUDED.late_minutes, note = EXCLUDED.note, updated_at = now();

  -- 휴가 신청 대기 1건 (전산·사무 박하늘, 내일 반차)
  INSERT INTO public.staff_leave_requests (
    facility_id, staff_id, leave_type, start_date, end_date, requested_minutes, reason, status
  )
  SELECT facility_id, id, 'half_day', v_today + 1, v_today + 1, 240, '데모: 오후 개인 일정', 'pending'
  FROM public.facility_staff WHERE facility_id = v_ph AND phone LIKE '%-03';

  INSERT INTO public.facility_attendance_qr (facility_id, is_active)
  VALUES (v_ph, true)
  ON CONFLICT (facility_id) DO UPDATE SET is_active = true;

  -- 대체약사 공고 재생성: 만료된 데모 공고 정리 후 내일 오전 1건 + 지원 1건
  DELETE FROM public.shift_applications WHERE shift_id IN (
    SELECT id FROM public.shifts WHERE facility_id = v_ph AND status = 'open'
  );
  DELETE FROM public.shifts WHERE facility_id = v_ph AND status = 'open';

  INSERT INTO public.shifts (
    facility_id, required_role, shift_date, start_time, end_time, hourly_wage,
    estimated_total_pay, description, department, notes, status
  ) VALUES (
    v_ph, 'pharmacist', v_today + 1, '09:00', '13:00', 38000, 152000,
    '오전 대체약사 근무 · 처방 조제 및 복약지도', '대체약사',
    '약사 면허 확인 후 지원 가능 · 주차 가능', 'open'
  ) RETURNING id INTO v_shift;

  INSERT INTO public.shifts (
    facility_id, required_role, shift_date, start_time, end_time, hourly_wage,
    estimated_total_pay, description, department, notes, status
  ) VALUES (
    v_ph, 'pharmacy_staff', v_today + 2, '14:00', '18:00', 13500, 54000,
    '처방전 전산 입력 보조, 서류 및 재고·매대 정리', '전산·접수',
    '조제·의약품 판매·복약지도 업무 없음', 'open'
  );

  IF v_worker IS NOT NULL AND v_shift IS NOT NULL THEN
    INSERT INTO public.shift_applications (shift_id, worker_id, status)
    VALUES (v_shift, v_worker, 'applied')
    ON CONFLICT (shift_id, worker_id) DO NOTHING;
  END IF;

  RETURN QUERY
  SELECT 'pharmacy_staff'::text, count(*) FROM public.facility_staff
    WHERE facility_id = v_ph AND phone LIKE 'DEMO-PHARMACY-%'
  UNION ALL
  SELECT 'today_attendance', count(*) FROM public.staff_attendances
    WHERE facility_id = v_ph AND work_date = v_today
  UNION ALL
  SELECT 'open_shifts', count(*) FROM public.shifts
    WHERE facility_id = v_ph AND status = 'open'
  UNION ALL
  SELECT 'applications', count(*) FROM public.shift_applications a
    JOIN public.shifts s ON s.id = a.shift_id WHERE s.facility_id = v_ph;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_demo_pharmacy_workforce() FROM PUBLIC, anon, authenticated;

-- ④ 요금제 시연: 데모 약국은 Pharmacy 플랜
UPDATE public.facilities SET plan_code = 'pharmacy'
WHERE business_registration_number = 'DEMO-TARGET-PHARMACY' AND is_demo = true;

-- ③ 매일 00:12 KST(15:12 UTC) 재생성 cron
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demo-pharmacy-workforce-daily';
SELECT cron.schedule('demo-pharmacy-workforce-daily', '12 15 * * *',
  'SELECT public.refresh_demo_pharmacy_workforce();');

-- 즉시 1회 실행 (결과 카운트 반환) — 병원 직원 오염 제거 + 약국 시드 생성
SELECT * FROM public.refresh_demo_pharmacy_workforce();

-- 검증: ①클리닉 함수가 약국 제외하는지 ②cron 등록됐는지
SELECT
  strpos(pg_get_functiondef(to_regprocedure('public.refresh_demo_clinic_workforce()')),
    'facility_type <> ''pharmacy''') > 0 AS clinic_cron_excludes_pharmacy,
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'demo-pharmacy-workforce-daily' AND active) AS pharmacy_cron_registered;
