-- 2026-11-12 시연 대화 보완: 운영 확인에서 약국 시연의 1:1 대화 한 줄기(반차 대화)가 빠졌다.
-- 시연 약사 계정은 앱으로 연결돼 있지만 로그인 계정(auth_user_id)이 없어, 로그인 있는 연결 직원만 고르던 시드가 약사를 건너뛰었다.
-- → 연결 직원이면 로그인 계정이 없어도 대화에 넣는다(보낸 사람 id 만 비고, 화면은 이름으로 보여 준다). 시드를 다시 돌린다.

CREATE OR REPLACE FUNCTION public.seed_demo_workroom(p_facility_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_t timestamptz := now();
  v_f record;
  v_kind text;
  v_admin uuid;
  v_admin_name text;
  v_a uuid; v_a_name text; v_a_uid uuid; v_a_worker uuid;
  v_b uuid; v_b_name text; v_b_uid uuid; v_b_worker uuid;
  v_check_body text; v_check_mins int; v_check_reply boolean := false;
  v_check uuid; v_msg uuid;
  v_n int := 0;
BEGIN
  SELECT id, name, facility_type, business_registration_number, admin_user_id INTO v_f
  FROM public.facilities WHERE id = p_facility_id AND is_demo = true;
  IF v_f.id IS NULL THEN RETURN 0; END IF;

  v_kind := CASE
    WHEN v_f.business_registration_number = 'DEMO-GIGWORKER-2026' THEN 'gig'
    WHEN v_f.facility_type = 'pharmacy' THEN 'pharmacy'
    WHEN v_f.facility_type = 'care_hospital' THEN 'care'
    ELSE 'hospital' END;
  v_admin_name := CASE v_kind WHEN 'gig' THEN '현장 매니저' WHEN 'pharmacy' THEN '약국장' WHEN 'care' THEN '수간호사' ELSE '원무과 실장' END;
  SELECT COALESCE(
    (SELECT a.user_id FROM public.facility_admin_access a JOIN auth.users u ON u.id = a.user_id
      WHERE a.facility_id = p_facility_id AND lower(u.email) LIKE '%@demo.atman.co.kr' ORDER BY a.created_at LIMIT 1),
    v_f.admin_user_id) INTO v_admin;

  -- 지난번 시연 대화만 지운다 (방문자가 시연 중 쓴 대화는 각 시연 정리 규칙에 맡긴다)
  DELETE FROM public.facility_workroom_checks c USING public.facility_workroom_messages m
  WHERE c.message_id = m.id AND m.facility_id = p_facility_id AND m.event_key LIKE 'demo-seed:%';
  DELETE FROM public.facility_workroom_messages WHERE facility_id = p_facility_id AND event_key LIKE 'demo-seed:%';

  -- 앱으로 연결된 시연 직원 (근무자 메시지는 연결된 사람만 보낼 수 있다). 시연 약사처럼 로그인 계정이 없는 연결 계정도 넣는다
  -- — 그 메시지는 sender_user_id 가 비어 신고·차단 버튼만 숨는다(2026-11-12 운영 확인: 약국 대화 한 줄기가 통째로 빠졌다).
  SELECT s.id, s.name, w.auth_user_id, w.id INTO v_a, v_a_name, v_a_uid, v_a_worker
  FROM public.facility_staff s JOIN public.workers w ON w.id = s.worker_id
  WHERE s.facility_id = p_facility_id AND s.status = 'active'
  ORDER BY s.phone NULLS LAST, s.created_at, s.id LIMIT 1;
  IF v_kind = 'gig' AND v_a IS NULL THEN
    -- 근무자 시연을 막 초기화해 연결이 풀린 순간에도 고정 근무자와의 대화는 보이게
    SELECT s.id, s.name INTO v_a, v_a_name FROM public.facility_staff s
    WHERE s.id = '20260922-0000-4000-8000-000000000004' AND s.facility_id = p_facility_id;
  END IF;
  SELECT s.id, s.name, w.auth_user_id, w.id INTO v_b, v_b_name, v_b_uid, v_b_worker
  FROM public.facility_staff s JOIN public.workers w ON w.id = s.worker_id
  WHERE s.facility_id = p_facility_id AND s.status = 'active' AND s.id <> COALESCE(v_a, gen_random_uuid())
  ORDER BY s.phone NULLS LAST, s.created_at, s.id LIMIT 1;

  -- thread: room(전체 공지) / a / b, sender: admin / a / b, mins: 지금으로부터 몇 분 전
  INSERT INTO public.facility_workroom_messages(facility_id, staff_id, sender_type, sender_user_id, sender_name, message_type, body, metadata, event_key, created_at)
  SELECT p_facility_id,
    CASE r.thread WHEN 'a' THEN v_a WHEN 'b' THEN v_b END,
    CASE WHEN r.sender = 'admin' THEN 'admin' ELSE 'worker' END,
    CASE r.sender WHEN 'admin' THEN v_admin WHEN 'a' THEN v_a_uid ELSE v_b_uid END,
    CASE r.sender WHEN 'admin' THEN v_admin_name WHEN 'a' THEN v_a_name ELSE v_b_name END,
    r.mtype,
    replace(replace(r.body, '{a}', CASE WHEN char_length(COALESCE(v_a_name, '')) = 3 THEN substr(v_a_name, 2) ELSE COALESCE(v_a_name, '') END),
                            '{b}', CASE WHEN char_length(COALESCE(v_b_name, '')) = 3 THEN substr(v_b_name, 2) ELSE COALESCE(v_b_name, '') END),
    '{}'::jsonb,
    'demo-seed:' || p_facility_id::text || ':' || r.seq,
    v_t - make_interval(mins => r.mins)
  FROM (VALUES
    -- 병원
    ('hospital', 1, 'room', 'admin', 'announcement', '[공지] 다음 주 월요일부터 외래 접수가 8시 30분에 시작해요. 외래 근무하시는 분들은 8시 20분까지 출근 부탁드려요.', 1560),
    ('hospital', 2, 'room', 'admin', 'announcement', '11월 급여명세서는 25일에 앱에서 볼 수 있어요. 연차는 쓰기 3일 전까지 앱으로 신청해 주세요.', 1500),
    ('hospital', 3, 'a', 'admin', 'message', '{a} 선생님, 이번 주 토요일 오전 외래 근무 가능하실까요? 최하은 선생님이 연차를 내셨어요.', 180),
    ('hospital', 4, 'a', 'a', 'message', '네 가능해요. 9시까지 가면 될까요?', 170),
    ('hospital', 5, 'a', 'admin', 'message', '네, 9시까지요. 근무표에 넣어 둘게요. 고마워요!', 165),
    ('hospital', 7, 'a', 'a', 'message', '실장님, 오늘 아이 병원에 들렀다 가느라 10분쯤 늦을 것 같아요. 죄송해요.', 25),
    ('hospital', 8, 'a', 'a', 'message', '도착하면 바로 출근 누를게요.', 24),
    -- 요양병원
    ('care', 1, 'room', 'admin', 'announcement', '[공지] 이번 주 목요일 오후 3시에 낙상 예방 교육이 있어요. 근무 중인 분은 2층 회의실로 와 주세요.', 1560),
    ('care', 2, 'room', 'admin', 'announcement', '야간 인수인계는 교대 10분 전까지 마쳐 주세요. 인계 내용은 기록지에도 꼭 남겨 주세요.', 1490),
    ('care', 3, 'a', 'a', 'message', '수간호사님, 다음 주 수요일 야간 근무를 금요일로 바꿀 수 있을까요?', 200),
    ('care', 4, 'a', 'admin', 'message', '정도윤 선생님과 맞춰 볼게요. 정해지면 근무표에 바로 반영할게요.', 190),
    ('care', 6, 'a', 'a', 'message', '정도윤 선생님이 금요일 괜찮다고 하셨어요. 바꿔 주시면 감사해요!', 20),
    -- 약국
    ('pharmacy', 1, 'room', 'admin', 'announcement', '[공지] 이번 주 금요일 오후 2시~3시에 의약품 입고가 많아요. 시간 되는 분은 진열 같이 부탁드려요.', 1560),
    ('pharmacy', 2, 'room', 'admin', 'announcement', '감기약 찾는 분이 늘어서 다음 주부터 토요일 오전 근무를 한 명 더 둘게요. 가능한 분은 대화로 알려 주세요.', 1480),
    ('pharmacy', 3, 'b', 'admin', 'message', '{b} 씨, 다음 달 근무표 올렸어요. 확인해 주세요.', 200),
    ('pharmacy', 4, 'b', 'b', 'message', '확인했어요. 둘째 주 수요일 오후 반차 써도 될까요?', 190),
    ('pharmacy', 5, 'b', 'admin', 'message', '네, 앱에서 반차 신청 올려 주세요. 바로 승인할게요.', 185),
    ('pharmacy', 6, 'b', 'b', 'message', '방금 반차 신청 올렸어요!', 15),
    ('pharmacy', 8, 'a', 'a', 'message', '국장님, 토요일 오전 근무 제가 할 수 있어요.', 30),
    -- 단기 (팝업스토어)
    ('gig', 1, 'room', 'admin', 'announcement', '[공지] 이번 주말 팝업 행사 근무자분들, 토요일 10시 50분까지 B1 행사장 입구로 와 주세요. 검은색 상의를 입고 오시면 돼요.', 1500),
    ('gig', 2, 'room', 'admin', 'announcement', '행사장 설치·철수 근무는 다음 달 초 3일이에요. 근무 건에서 날짜를 확인하고 초대를 수락해 주세요.', 1440),
    ('gig', 4, 'a', 'a', 'message', '확인 눌렀어요! 주차는 어디에 하면 될까요?', 228),
    ('gig', 5, 'a', 'admin', 'message', '건물 B2 주차장에 대시면 돼요. 주차권은 현장에서 드릴게요.', 220),
    ('gig', 6, 'a', 'a', 'message', '혹시 일요일 근무도 자리 있을까요?', 12)
  ) AS r(kind, seq, thread, sender, mtype, body, mins)
  WHERE r.kind = v_kind
    AND (r.thread = 'room' OR (r.thread = 'a' AND v_a IS NOT NULL) OR (r.thread = 'b' AND v_b IS NOT NULL))
    AND (r.sender = 'admin' OR (r.sender = 'a' AND v_a_worker IS NOT NULL) OR (r.sender = 'b' AND v_b_worker IS NOT NULL));
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- 출석 확인 1건 (1:1, 앱의 create_staff_workroom_checks 와 같은 모양). 단기는 근무자가 이미 확인을 눌렀다.
  v_check_body := CASE v_kind
    WHEN 'hospital' THEN '내일 오후 2시 감염관리 교육(2층 회의실)에 참석할 수 있으면 확인을 눌러 주세요.'
    WHEN 'care' THEN '내일 오전 9시 보호자 면담 일정을 봤으면 확인을 눌러 주세요.'
    WHEN 'pharmacy' THEN '이번 주 토요일 오전 근무(9시~13시) 나올 수 있으면 확인을 눌러 주세요.'
    ELSE '토요일 10시 50분까지 출근할 수 있으면 확인을 눌러 주세요.' END;
  v_check_mins := CASE v_kind WHEN 'gig' THEN 240 WHEN 'pharmacy' THEN 120 ELSE 90 END;
  v_check_reply := v_kind = 'gig';
  IF v_a IS NOT NULL THEN
    v_check := gen_random_uuid();
    INSERT INTO public.facility_workroom_messages(facility_id, staff_id, sender_type, sender_user_id, sender_name, message_type, body, metadata, event_key, created_at)
    VALUES (p_facility_id, v_a, 'admin', v_admin, v_admin_name, 'announcement', v_check_body,
      jsonb_build_object('kind', 'check', 'checkId', v_check, 'dueAt', v_t + interval '1 day', 'staffId', v_a),
      'demo-seed:' || p_facility_id::text || ':check', v_t - make_interval(mins => v_check_mins))
    RETURNING id INTO v_msg;
    INSERT INTO public.facility_workroom_checks(id, facility_id, message_id, body, due_at, created_by, created_at)
    VALUES (v_check, p_facility_id, v_msg, v_check_body, v_t + interval '1 day', v_admin, v_t - make_interval(mins => v_check_mins));
    IF v_check_reply AND v_a_worker IS NOT NULL THEN
      INSERT INTO public.facility_workroom_check_replies(check_id, staff_id, worker_id, replied_at)
      VALUES (v_check, v_a, v_a_worker, v_t - make_interval(mins => v_check_mins - 10))
      ON CONFLICT DO NOTHING;
    END IF;
    v_n := v_n + 1;
  END IF;

  -- 관리자 읽음: 45분 전까지 읽은 것으로 → 그 뒤 근무자 메시지가 '대화' 탭 숫자로 보인다
  DELETE FROM public.facility_workroom_thread_reads tr
  WHERE tr.facility_id = p_facility_id AND tr.staff_id IN (v_a, v_b)
    AND tr.user_id IN (SELECT a.user_id FROM public.facility_admin_access a WHERE a.facility_id = p_facility_id UNION SELECT v_f.admin_user_id);
  INSERT INTO public.facility_workroom_thread_reads(facility_id, staff_id, user_id, last_read_at)
  SELECT p_facility_id, st.id, u.user_id, v_t - interval '45 minutes'
  FROM (SELECT v_a AS id UNION SELECT v_b) st
  CROSS JOIN (SELECT a.user_id FROM public.facility_admin_access a WHERE a.facility_id = p_facility_id
              UNION SELECT v_f.admin_user_id WHERE v_f.admin_user_id IS NOT NULL) u
  WHERE st.id IS NOT NULL
  ON CONFLICT (facility_id, staff_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;

  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_demo_workroom(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_workroom(uuid) TO service_role;

SELECT * FROM public.seed_demo_workrooms();
