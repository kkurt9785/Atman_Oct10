-- Link the hospital sales demo to the worker behind the actual login email,
-- rather than assuming a kakao_id suffix.
DO $$
DECLARE
  v_hospital uuid;
  v_nurse uuid;
  v_shift uuid;
  v_application uuid;
  v_attendance uuid;
BEGIN
  SELECT id INTO v_hospital FROM public.facilities
  WHERE name = 'W여성병원' AND is_demo = true AND is_active = true AND deleted_at IS NULL
  ORDER BY business_registration_number LIMIT 1;

  SELECT worker.id INTO v_nurse
  FROM public.workers worker
  JOIN auth.users account ON account.id = worker.auth_user_id
  WHERE account.email = 'worker-demo-2@demo.atman.co.kr'
    AND worker.is_demo = true AND worker.deleted_at IS NULL
  LIMIT 1;

  IF v_hospital IS NULL OR v_nurse IS NULL THEN
    RAISE EXCEPTION 'hospital worker sales demo target is missing';
  END IF;

  SELECT id INTO v_shift FROM public.shifts
  WHERE notes = 'DEMO-WORKER-SALES-HOSPITAL-COMPLETED' LIMIT 1;
  IF v_shift IS NULL THEN
    INSERT INTO public.shifts (
      facility_id, required_role, shift_date, start_time, end_time, hourly_wage,
      estimated_total_pay, description, department, notes, status, matched_worker_id, matched_at
    ) VALUES (
      v_hospital, 'rn', current_date - 7, '09:00', '17:00', 17500, 140000,
      '시연용 완료 근무 · 병원 지원부터 근태와 급여까지 연결됩니다.', '외래',
      'DEMO-WORKER-SALES-HOSPITAL-COMPLETED', 'completed', v_nurse, now() - interval '7 days'
    ) RETURNING id INTO v_shift;
  ELSE
    UPDATE public.shifts SET matched_worker_id = v_nurse, status = 'completed', updated_at = now()
    WHERE id = v_shift;
  END IF;

  INSERT INTO public.shift_applications (
    shift_id, worker_id, status, match_score, distance_meters, applied_at, responded_at
  ) VALUES (
    v_shift, v_nurse, 'accepted', 96, 720, now() - interval '9 days', now() - interval '8 days'
  ) ON CONFLICT (shift_id, worker_id) DO UPDATE SET
    status = 'accepted', responded_at = EXCLUDED.responded_at
  RETURNING id INTO v_application;

  INSERT INTO public.shift_attendances (
    shift_id, worker_id, application_id, check_in_at, check_out_at,
    check_in_distance_m, check_out_distance_m, check_in_method,
    check_out_method, check_out_hmac_verified
  ) VALUES (
    v_shift, v_nurse, v_application,
    (current_date - 7)::timestamp + time '08:57',
    (current_date - 7)::timestamp + time '17:03',
    18, 14, 'button', 'qr', true
  ) ON CONFLICT (application_id) DO UPDATE SET
    check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at,
    check_in_distance_m = EXCLUDED.check_in_distance_m,
    check_out_distance_m = EXCLUDED.check_out_distance_m
  RETURNING id INTO v_attendance;

  INSERT INTO public.wage_payment_instructions (
    facility_id, worker_id, shift_id, attendance_id, gross_amount,
    deduction_status, net_amount, due_date, status, created_at, updated_at
  ) VALUES (
    v_hospital, v_nurse, v_shift, v_attendance, 140000,
    'unconfirmed', 140000, current_date + 1, 'approved', now() - interval '6 days', now()
  ) ON CONFLICT (attendance_id) DO UPDATE SET
    worker_id = EXCLUDED.worker_id, gross_amount = EXCLUDED.gross_amount,
    net_amount = EXCLUDED.net_amount, due_date = EXCLUDED.due_date,
    status = 'approved', updated_at = now();
END $$;
