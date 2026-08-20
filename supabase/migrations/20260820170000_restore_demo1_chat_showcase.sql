-- W여성병원 영업 데모에서 관리자·워커 채팅을 항상 바로 열 수 있도록 보장한다.
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
  v_app uuid;
BEGIN
  SELECT w.id INTO v_worker
  FROM public.workers w
  JOIN auth.users u ON u.id = w.auth_user_id
  WHERE u.email = 'worker-demo-1@demo.atman.co.kr'
    AND w.deleted_at IS NULL;
  SELECT id INTO v_facility
  FROM public.facilities
  WHERE is_demo = true AND is_active = true AND deleted_at IS NULL
    AND (business_registration_number = 'DEMO-TARGET-0001' OR name LIKE 'W여성%')
  ORDER BY (business_registration_number = 'DEMO-TARGET-0001') DESC
  LIMIT 1;
  IF v_worker IS NULL OR v_facility IS NULL THEN RETURN 'demo target missing'; END IF;

  SELECT id INTO v_shift FROM public.shifts
  WHERE facility_id = v_facility AND notes = 'DEMO-1-CHAT-SHOWCASE'
  ORDER BY created_at DESC LIMIT 1;
  IF v_shift IS NULL THEN
    INSERT INTO public.shifts(
      facility_id, required_role, shift_date, start_time, end_time,
      hourly_wage, estimated_total_pay, description, department, notes,
      status, matched_worker_id, matched_at, audience
    ) VALUES (
      v_facility, 'rn', (now() AT TIME ZONE 'Asia/Seoul')::date + 1,
      '09:00', '17:00', 18000, 144000,
      'W여성병원 시연용 확정 근무 · 지원부터 채팅까지 확인합니다.',
      '병동', 'DEMO-1-CHAT-SHOWCASE', 'matched', v_worker, now(), 'public'
    ) RETURNING id INTO v_shift;
  ELSE
    UPDATE public.shifts SET status='matched', matched_worker_id=v_worker,
      matched_at=COALESCE(matched_at, now()), shift_date=(now() AT TIME ZONE 'Asia/Seoul')::date + 1
    WHERE id=v_shift;
  END IF;

  SELECT id INTO v_app FROM public.shift_applications
  WHERE shift_id=v_shift AND worker_id=v_worker;
  IF v_app IS NULL THEN
    INSERT INTO public.shift_applications(shift_id, worker_id, status, responded_at)
    VALUES(v_shift, v_worker, 'accepted', now()) RETURNING id INTO v_app;
  ELSE
    UPDATE public.shift_applications SET status='accepted', responded_at=COALESCE(responded_at,now()) WHERE id=v_app;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE application_id=v_app) THEN
    INSERT INTO public.chat_messages(application_id,sender_type,body,created_at) VALUES
      (v_app,'system','채용이 확정됐어요! 🎉 근무 일정과 출퇴근 안내를 이 채팅에서 확인하세요.',now()-interval '5 minutes'),
      (v_app,'facility','안녕하세요. 내일 오전 9시 근무입니다. 도착하면 앱에서 출근하기를 눌러주세요.',now()-interval '4 minutes'),
      (v_app,'worker','네, 확인했습니다. 10분 전에 도착해서 출근 인증하겠습니다.',now()-interval '3 minutes');
  END IF;
  RETURN 'ready';
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_demo1_chat_showcase() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_demo1_chat_showcase() TO service_role;
SELECT public.ensure_demo1_chat_showcase();

