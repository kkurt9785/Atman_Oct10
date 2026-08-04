-- ============================================================================
-- 데모 계정 정리 (2026-08-04): worker-demo-2 = 약국 전산·사무직 시연 계정
--   demo-1(병원 워커 시연)과 분리 — demo-2는 약국 직원(박하늘) 연결 계정.
--   refresh_demo_pharmacy_workforce를 교체해 매일 재시드 후에도
--   ① 김서현(약사) ↔ demo_pharmacist_1 (worker-demo-6)
--   ② 박하늘(전산·사무) ↔ worker-demo-2 계정
--   링크가 유지되도록 한다. (기존 demo_pharmacy_staff_1 계정은 예비로 잔존)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_demo_pharmacy_workforce()
RETURNS TABLE(kind text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_ph uuid;
  v_worker uuid;        -- 약사 시연 계정 (worker-demo-6)
  v_staff_worker uuid;  -- 약국 직원 시연 계정 (worker-demo-2)
  v_shift uuid;
BEGIN
  SELECT id INTO v_ph FROM public.facilities
  WHERE is_demo = true AND business_registration_number = 'DEMO-TARGET-PHARMACY'
    AND is_active = true AND deleted_at IS NULL;
  IF v_ph IS NULL THEN RAISE EXCEPTION 'demo pharmacy (DEMO-TARGET-PHARMACY) not found'; END IF;

  SELECT id INTO v_worker FROM public.workers
  WHERE is_demo = true AND kakao_id = 'demo_pharmacist_1' AND deleted_at IS NULL;

  SELECT w.id INTO v_staff_worker
  FROM public.workers w
  JOIN auth.users u ON u.id = w.auth_user_id
  WHERE u.email = 'worker-demo-2@demo.atman.co.kr' AND w.deleted_at IS NULL;

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
    (v_ph, v_staff_worker, '박하늘 (데모)', 'DEMO-PHARMACY-03', 'pharmacy_staff', '전산·접수',
     CASE WHEN v_staff_worker IS NULL THEN 'imported' ELSE 'atman' END, 'regular',
     NULL, NULL, '09:00', '18:00', 60, 'active', 'monthly', 2400000, ARRAY[1,2,3,4,5]::smallint[]);

  INSERT INTO public.staff_leave_balances (facility_id, staff_id, leave_year, granted_minutes, used_minutes, note)
  SELECT facility_id, id, extract(year from v_today)::integer, 7200,
         CASE WHEN phone LIKE '%-01' THEN 960 ELSE 0 END, '데모: 연차 부여'
  FROM public.facility_staff WHERE facility_id = v_ph AND phone LIKE 'DEMO-PHARMACY-%'
  ON CONFLICT (staff_id, leave_year) DO UPDATE SET
    granted_minutes = EXCLUDED.granted_minutes, used_minutes = EXCLUDED.used_minutes,
    note = EXCLUDED.note, updated_at = now();

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

  INSERT INTO public.staff_leave_requests (
    facility_id, staff_id, leave_type, start_date, end_date, requested_minutes, reason, status
  )
  SELECT facility_id, id, 'half_day', v_today + 1, v_today + 1, 240, '데모: 오후 개인 일정', 'pending'
  FROM public.facility_staff WHERE facility_id = v_ph AND phone LIKE '%-03';

  INSERT INTO public.facility_attendance_qr (facility_id, is_active)
  VALUES (v_ph, true)
  ON CONFLICT (facility_id) DO UPDATE SET is_active = true;

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
    '면허 업무 제외 · 주차 가능', 'open'
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
  SELECT 'linked_accounts', count(*) FROM public.facility_staff
    WHERE facility_id = v_ph AND worker_id IS NOT NULL
  UNION ALL
  SELECT 'open_shifts', count(*) FROM public.shifts
    WHERE facility_id = v_ph AND status = 'open';
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_demo_pharmacy_workforce() FROM PUBLIC, anon, authenticated;

-- 즉시 1회 실행 — linked_accounts가 2(약사+직원)면 성공
SELECT * FROM public.refresh_demo_pharmacy_workforce();
