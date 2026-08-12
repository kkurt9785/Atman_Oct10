-- Keep the W여성병원 worker-demo-1 flow anchored to the login identity.
-- kakao_id ordering is seed-dependent and must not decide which demo account is shown.

CREATE OR REPLACE FUNCTION public.ensure_demo1_wf_application()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker uuid;
  v_facility uuid;
  v_shift uuid;
BEGIN
  SELECT w.id INTO v_worker
  FROM public.workers w
  JOIN auth.users u ON u.id = w.auth_user_id
  WHERE u.email = 'worker-demo-1@demo.atman.co.kr'
    AND w.is_demo = true AND w.deleted_at IS NULL
  LIMIT 1;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'worker-demo-1 login worker not found'; END IF;

  SELECT id INTO v_facility FROM public.facilities
  WHERE is_demo = true AND name LIKE 'W여성%' AND is_active = true AND deleted_at IS NULL
  ORDER BY business_registration_number LIMIT 1;
  IF v_facility IS NULL THEN RAISE EXCEPTION 'W여성병원 demo facility not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_applications a JOIN public.shifts s ON s.id = a.shift_id
    WHERE a.worker_id = v_worker AND a.status = 'applied'
      AND s.facility_id = v_facility AND s.status = 'open'
  ) THEN RETURN 'already applied'; END IF;

  SELECT s.id INTO v_shift FROM public.shifts s
  WHERE s.facility_id = v_facility AND s.status = 'open'
    AND s.required_role IN ('rn', 'any')
    AND s.shift_date >= (now() AT TIME ZONE 'Asia/Seoul')::date
    AND NOT EXISTS (
      SELECT 1 FROM public.shift_applications a
      WHERE a.shift_id = s.id AND a.worker_id = v_worker
        AND a.status IN ('accepted', 'completed')
    )
  ORDER BY s.shift_date, s.start_time LIMIT 1;
  IF v_shift IS NULL THEN RETURN 'no eligible shift'; END IF;

  INSERT INTO public.shift_applications (shift_id, worker_id, status)
  VALUES (v_shift, v_worker, 'applied')
  ON CONFLICT (shift_id, worker_id) DO UPDATE
    SET status = 'applied', applied_at = now()
    WHERE public.shift_applications.status NOT IN ('accepted', 'completed');
  RETURN 'seeded';
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_demo1_chat_showcase()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker uuid;
  v_facility uuid;
  v_shift uuid;
  v_application uuid;
BEGIN
  SELECT w.id INTO v_worker
  FROM public.workers w JOIN auth.users u ON u.id = w.auth_user_id
  WHERE u.email = 'worker-demo-1@demo.atman.co.kr'
    AND w.is_demo = true AND w.deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_facility FROM public.facilities
  WHERE is_demo = true AND name LIKE 'W여성%' AND is_active = true AND deleted_at IS NULL
  ORDER BY business_registration_number LIMIT 1;
  IF v_worker IS NULL OR v_facility IS NULL THEN
    RAISE EXCEPTION 'demo-1 chat target is missing';
  END IF;

  SELECT s.id INTO v_shift FROM public.shifts s
  WHERE s.facility_id = v_facility AND s.notes = 'DEMO-1-CHAT-SHOWCASE'
  ORDER BY s.created_at DESC LIMIT 1;
  IF v_shift IS NULL THEN
    INSERT INTO public.shifts(
      facility_id,required_role,shift_date,start_time,end_time,hourly_wage,
      estimated_total_pay,description,department,notes,status,matched_worker_id,matched_at
    ) VALUES (
      v_facility,'rn',(now() AT TIME ZONE 'Asia/Seoul')::date + 1,'15:00','18:00',18000,
      54000,'시연용 확정 근무 · 관리자와 워커 채팅을 확인합니다.','외래','DEMO-1-CHAT-SHOWCASE',
      'matched',v_worker,now()
    ) RETURNING id INTO v_shift;
  ELSE
    UPDATE public.shifts SET shift_date=(now() AT TIME ZONE 'Asia/Seoul')::date + 1,
      status='matched',matched_worker_id=v_worker,matched_at=COALESCE(matched_at,now()),updated_at=now()
    WHERE id=v_shift;
  END IF;

  INSERT INTO public.shift_applications(shift_id,worker_id,status,match_score,applied_at,responded_at)
  VALUES(v_shift,v_worker,'accepted',98,now()-interval '20 minutes',now()-interval '15 minutes')
  ON CONFLICT(shift_id,worker_id) DO UPDATE SET
    status='accepted',responded_at=COALESCE(public.shift_applications.responded_at,now())
  RETURNING id INTO v_application;

  INSERT INTO public.chat_messages(application_id,sender_type,sender_id,body,created_at)
  SELECT v_application, message.sender_type, NULL, message.body,
    now()-interval '5 minutes'+make_interval(mins=>message.offset_minutes)
  FROM (VALUES
    ('system',E'채용이 확정됐어요! 🎉\n근무 일정과 출퇴근 안내를 이 채팅에서 확인하세요.',0),
    ('facility','안녕하세요. 내일 외래 근무는 오후 3시 시작입니다. 도착하면 앱에서 출근하기를 눌러주세요.',1),
    ('worker','네, 확인했습니다. 10분 전에 도착해서 출근 인증하겠습니다.',2)
  ) AS message(sender_type,body,offset_minutes)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.chat_messages c
    WHERE c.application_id=v_application AND c.body=message.body
  );
  RETURN 'ready';
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_demo1_wf_application() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_demo1_chat_showcase() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_demo1_wf_application() TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_demo1_chat_showcase() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='demo1-chat-showcase-daily';
SELECT cron.schedule('demo1-chat-showcase-daily','55 23 * * *','SELECT public.ensure_demo1_chat_showcase();');

SELECT public.ensure_demo1_wf_application();
SELECT public.ensure_demo1_chat_showcase();
