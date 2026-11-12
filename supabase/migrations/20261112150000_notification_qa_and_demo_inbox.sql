-- 2026-11-12 알림·데이터 흐름 QA 반영 (사용자 승인: "ab 진행하자")
-- A. 시연: ① 시연 계정의 오래된 알림·내부 테스트 알림 삭제(오늘 08:25 이전 것) + 매일 되살리기 때 다시 비움
--          ② 오늘 대화·연차 신청과 맞는 알림을 시연 알림함에 넣음 ③ 시연 대화 문구를 시연 데이터와 맞춤
--          ④ 시연 로그인할 때마다 대화·읽음 시각을 지금 기준으로 다시 만듦(앞사람이 읽어 숫자가 사라진 채 다음 사람이 보지 않게)
-- B. 알림: ① 한 기기(endpoint)는 마지막으로 알림을 켠 계정 하나만 — 로그아웃한 계정·시연 계정 알림이 남의 폰으로 가지 않게
--          ② 알림 문구: '휴가 신청이 들어왔어요' → 종류 이름, '병원에서 메시지' → '사업장에서', 해요체, '워커' 대체값
--          ③ 새 지원 알림에 사업장 정보(facilityId) — 사업장이 여럿인 관리자의 다른 사업장 알림함에 섞이던 것

-- ── B①: 기기 하나에 계정 하나 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_endpoint_single_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 같은 기기를 다른 계정이 쓰던 구독은 지운다(공용·가족 폰, 시연을 끝낸 방문자 폰)
  DELETE FROM public.push_subscriptions WHERE endpoint = NEW.endpoint AND worker_id <> NEW.worker_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_push_endpoint_single_owner ON public.push_subscriptions;
CREATE TRIGGER trg_push_endpoint_single_owner
  AFTER INSERT OR UPDATE OF endpoint, worker_id ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.push_endpoint_single_owner();

-- 이미 겹친 구독: 기기마다 가장 최근에 켠 계정만 남긴다
DO $dupes$
BEGIN
  DELETE FROM public.push_subscriptions p
  USING public.push_subscriptions newer
  WHERE newer.endpoint = p.endpoint AND newer.worker_id <> p.worker_id
    AND (newer.updated_at, newer.worker_id) > (p.updated_at, p.worker_id);
EXCEPTION WHEN others THEN RAISE WARNING 'push duplicate cleanup skipped: %', SQLERRM;
END $dupes$;

-- ── B②·③: 알림 문구·사업장 정보 (함수 안 문구만 바꾼다) ──────────────────────
DO $copy$
DECLARE
  r record; v_def text; v_new text; v_n int := 0;
  -- 어느 함수에서나 그대로 바꿔도 되는 알림 문구(정확히 같은 문자열만)
  v_common text[][] := ARRAY[
    ['''💬 병원에서 메시지가 왔어요''', '''💬 사업장에서 메시지가 왔어요'''],
    ['''워커에게 메시지가 왔어요''', '''근무자 메시지가 왔어요'''],
    ['근무시간이 반영됩니다.', '근무시간이 반영돼요.'],
    ['확인이 필요합니다.', '확인이 필요해요.'],
    ['jsonb_build_object(''url'',''/applications'',''applicationId'',NEW.id,''shiftId'',v_shift.id)', 'jsonb_build_object(''url'',''/applications'',''applicationId'',NEW.id,''shiftId'',v_shift.id,''facilityId'',v_shift.facility_id)'],
    ['COALESCE(v_worker_name, ''워커'')', 'COALESCE(v_worker_name, ''지원자'')']
  ];
  -- 알림 함수에서만: 이름이 비었을 때 쓰는 대체값 '워커'·'근로자' (오류 안내문의 '워커'는 앱이 기대는지 확인 전이라 이번엔 두지 않는다)
  v_fallback_fns text[] := ARRAY['enqueue_admin_new_application','enqueue_admin_worker_chat_message','enqueue_credential_confirmation_notifications',
                                 'request_shift_cover','claim_shift_cover','send_facility_workroom_message','send_staff_workroom_message','enqueue_admin_attendance_exception'];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND (p.prosrc LIKE '%휴가 신청이 들어왔어요%' OR p.prosrc LIKE '%병원에서 메시지가 왔어요%' OR p.prosrc LIKE '%워커에게 메시지가 왔어요%'
        OR p.prosrc LIKE '%근무시간이 반영됩니다.%' OR p.prosrc LIKE '%확인이 필요합니다.%' OR p.prosrc LIKE '%''shiftId'',v_shift.id)%'
        OR (p.proname = ANY (v_fallback_fns) AND (p.prosrc LIKE '%''워커'')%' OR p.prosrc LIKE '%''근로자''%')))
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    -- 종류 이름 변수(v_type)는 연차 신청 알림 함수에만 있다
    IF position('v_type :=' IN v_new) > 0 THEN
      v_new := replace(v_new, '''휴가 신청이 들어왔어요'',', 'v_type || '' 신청이 들어왔어요'',');
    END IF;
    FOR i IN 1 .. array_length(v_common, 1) LOOP
      v_new := replace(v_new, v_common[i][1], v_common[i][2]);
    END LOOP;
    IF r.proname = ANY (v_fallback_fns) THEN
      v_new := replace(v_new, '''워커'')', '''근무자'')');
      v_new := replace(v_new, '''근로자''', '''근무자''');
    END IF;
    IF v_new <> v_def THEN EXECUTE v_new; v_n := v_n + 1; END IF;
  END LOOP;
  RAISE NOTICE 'notification copy: % functions', v_n;
END $copy$;

-- 이미 쌓인 시스템 문구·알림 제목 (사람이 쓴 내용은 그대로)
DO $copy_rows$
BEGIN
  UPDATE public.notification_outbox SET title = '💬 사업장에서 메시지가 왔어요' WHERE title = '💬 병원에서 메시지가 왔어요';
  UPDATE public.notification_outbox SET title = '근무자 메시지가 왔어요' WHERE title = '워커에게 메시지가 왔어요';
  UPDATE public.chat_messages SET body = replace(replace(body,
      '문의사항은 이 채팅으로 남겨주세요. 근무 종료 24시간 후 채팅이 잠기며, 기록은 분쟁 대비를 위해 보관됩니다.',
      '궁금한 점은 이 채팅으로 남겨 주세요. 근무 종료 24시간 후 채팅이 잠기고, 기록은 분쟁에 대비해 보관해요.'),
      '매칭이 확정됐어요!', '채용이 확정됐어요!')
  WHERE sender_type = 'system' AND (body LIKE '%기록은 분쟁 대비를 위해 보관됩니다.%' OR body LIKE '%매칭이 확정됐어요!%');
EXCEPTION WHEN others THEN RAISE WARNING 'copy rows skipped: %', SQLERRM;
END $copy_rows$;

-- 이미 쌓인 새 지원 알림에도 사업장 정보를 채운다
DO $backfill$
BEGIN
  UPDATE public.notification_outbox n SET data = n.data || jsonb_build_object('facilityId', s.facility_id)
  FROM public.shifts s
  WHERE n.event_type = 'shift.applied' AND NOT (n.data ? 'facilityId') AND NOT (n.data ? 'facility_id')
    AND (n.data->>'shiftId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND s.id = (n.data->>'shiftId')::uuid;
EXCEPTION WHEN others THEN RAISE WARNING 'shift.applied facility backfill skipped: %', SQLERRM;
END $backfill$;

-- ── A①: 시연 계정 알림 비우기 ────────────────────────────────────────────────
-- 시연 직원은 매일 다시 만들어져 지난 알림의 링크(직원 id)가 깨진다. 되살리기 시작 때 시연 계정 알림을 비우고, 그날 것만 다시 쌓는다.
CREATE OR REPLACE FUNCTION public.prune_demo_notifications(p_before timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.notification_outbox n
  WHERE n.created_at < p_before AND n.dedupe_key NOT LIKE 'demo-seed:%'
    AND public.is_demo_account(n.worker_auth_user_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_demo_notifications(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_demo_notifications(timestamptz) TO service_role;

-- 오늘 아침 되살리기(08:30) 이전 것 — 9월 "출근 인증 실패" 반복, 8월 푸시 테스트, 3,000원 테스트 근무 알림 등
SELECT public.prune_demo_notifications((((now() AT TIME ZONE 'Asia/Seoul')::date + time '08:25') AT TIME ZONE 'Asia/Seoul'));

-- ── A②·③: 시연 대화·알림 시드 ───────────────────────────────────────────────
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
    ('hospital', 3, 'a', 'admin', 'message', '{a} 선생님, 이번 주 토요일 오전 외래 근무 가능하실까요? 예약이 많이 잡혀서요.', 180),
    ('hospital', 4, 'a', 'a', 'message', '네 가능해요. 9시까지 가면 될까요?', 170),
    ('hospital', 5, 'a', 'admin', 'message', '네, 9시까지요. 근무표에 넣어 둘게요. 고마워요!', 165),
    ('hospital', 7, 'a', 'a', 'message', '실장님, 내일 반차 신청 올렸어요. 오후에 병원 진료가 있어서요.', 25),
    ('hospital', 8, 'a', 'a', 'message', '확인 부탁드려요!', 24),
    -- 요양병원
    ('care', 1, 'room', 'admin', 'announcement', '[공지] 이번 주 목요일 오후 3시에 낙상 예방 교육이 있어요. 근무 중인 분은 2층 회의실로 와 주세요.', 1560),
    ('care', 2, 'room', 'admin', 'announcement', '야간 인수인계는 교대 10분 전까지 마쳐 주세요. 인계 내용은 기록지에도 꼭 남겨 주세요.', 1490),
    ('care', 3, 'a', 'a', 'message', '수간호사님, 다음 주 수요일 근무를 금요일로 바꿀 수 있을까요?', 200),
    ('care', 4, 'a', 'admin', 'message', '박서윤 선생님과 맞춰 볼게요. 정해지면 근무표에 바로 반영할게요.', 190),
    ('care', 6, 'a', 'a', 'message', '박서윤 선생님이 금요일 괜찮다고 하셨어요. 바꿔 주시면 감사해요!', 20),
    -- 약국
    ('pharmacy', 1, 'room', 'admin', 'announcement', '[공지] 이번 주 금요일 오후 2시~3시에 의약품 입고가 많아요. 시간 되는 분은 진열 같이 부탁드려요.', 1560),
    ('pharmacy', 2, 'room', 'admin', 'announcement', '감기약 찾는 분이 늘어서 다음 주부터 토요일 오전 근무를 한 명 더 둘게요. 가능한 분은 대화로 알려 주세요.', 1480),
    ('pharmacy', 3, 'b', 'admin', 'message', '{b} 씨, 다음 달 근무표 올렸어요. 확인해 주세요.', 200),
    ('pharmacy', 4, 'b', 'b', 'message', '확인했어요. 그리고 내일 오후에 반차 써도 될까요?', 190),
    ('pharmacy', 5, 'b', 'admin', 'message', '네, 앱에서 반차 신청 올려 주세요. 확인하고 승인할게요.', 185),
    ('pharmacy', 6, 'b', 'b', 'message', '방금 반차 신청 올렸어요!', 15),
    ('pharmacy', 8, 'a', 'a', 'message', '국장님, 확인 눌렀어요. 토요일 오전에 나올게요.', 30),
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
    WHEN 'hospital' THEN '다음 주 월요일 오전 10시 감염관리 교육(2층 회의실)에 참석할 수 있으면 확인을 눌러 주세요.'
    WHEN 'care' THEN '내일 오전 9시 보호자 면담 일정을 봤으면 확인을 눌러 주세요.'
    WHEN 'pharmacy' THEN '이번 주 토요일 오전 근무(9시~13시) 나올 수 있으면 확인을 눌러 주세요.'
    ELSE '토요일 10시 50분까지 출근할 수 있으면 확인을 눌러 주세요.' END;
  v_check_mins := CASE v_kind WHEN 'gig' THEN 240 WHEN 'pharmacy' THEN 120 ELSE 90 END;
  v_check_reply := v_kind IN ('gig', 'pharmacy');
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

  -- 시연 알림함: 지난 시드 알림을 지우고 오늘 데이터와 맞는 것만 다시 넣는다. 받는 사람은 시연 계정뿐이고 푸시는 나가지 않는다(status 'sent').
  BEGIN
    DELETE FROM public.notification_outbox WHERE dedupe_key LIKE 'demo-seed:' || p_facility_id::text || ':%';
    -- 관리자: 아직 안 읽은 근무자 메시지(대화방별 마지막 1건)
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data, status, sent_at, created_at)
    SELECT u.user_id, 'workroom.direct', 'demo-seed:' || p_facility_id::text || ':msg:' || m.staff_id::text || ':' || u.user_id::text,
      m.sender_name || '님의 메시지', left(m.body, 80),
      jsonb_build_object('url', '/workroom?staff=' || m.staff_id::text, 'kind', 'workroom.direct', 'facilityId', p_facility_id, 'staffId', m.staff_id, 'messageId', m.id),
      'sent', m.created_at, m.created_at
    FROM (
      SELECT DISTINCT ON (x.staff_id) x.id, x.staff_id, x.sender_name, x.body, x.created_at
      FROM public.facility_workroom_messages x
      WHERE x.facility_id = p_facility_id AND x.event_key LIKE 'demo-seed:%' AND x.sender_type = 'worker'
        AND x.staff_id IS NOT NULL AND x.created_at > v_t - interval '45 minutes'
      ORDER BY x.staff_id, x.created_at DESC
    ) m
    CROSS JOIN (SELECT a.user_id FROM public.facility_admin_access a WHERE a.facility_id = p_facility_id
                UNION SELECT v_f.admin_user_id WHERE v_f.admin_user_id IS NOT NULL) u
    WHERE public.is_demo_account(u.user_id)
    ON CONFLICT (dedupe_key) DO NOTHING;
    -- 관리자: 승인을 기다리는 연차·반차 신청 (실사용과 같은 문구 — 시연 사업장은 신청 알림 트리거가 건너뛴다)
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data, status, sent_at, created_at)
    SELECT u.user_id, 'leave.requested', 'demo-seed:' || p_facility_id::text || ':leave:' || r.id::text || ':' || u.user_id::text,
      r.type_label || ' 신청이 들어왔어요',
      format('%s님이 %s %s를 신청했어요. 승인하거나 반려해 주세요.', r.staff_name, r.period, r.type_label),
      jsonb_build_object('url', '/leave', 'kind', 'leave.requested', 'facilityId', p_facility_id, 'leaveRequestId', r.id),
      'sent', v_t - interval '50 minutes', v_t - interval '50 minutes'
    FROM (
      SELECT l.id, s.name AS staff_name,
        to_char(l.start_date, 'FMMM/FMDD') || CASE WHEN l.end_date <> l.start_date THEN '~' || to_char(l.end_date, 'FMMM/FMDD') ELSE '' END AS period,
        CASE l.leave_type WHEN 'annual' THEN '연차'
          WHEN 'half_day' THEN CASE l.half_day_period WHEN 'am' THEN '오전 반차' WHEN 'pm' THEN '오후 반차' ELSE '반차' END
          WHEN 'quarter_day' THEN '반반차' WHEN 'hourly' THEN '시간 휴가' WHEN 'sick' THEN '병가' ELSE '휴가' END AS type_label
      FROM public.staff_leave_requests l JOIN public.facility_staff s ON s.id = l.staff_id
      WHERE l.facility_id = p_facility_id AND l.status = 'pending'
    ) r
    CROSS JOIN (SELECT a.user_id FROM public.facility_admin_access a WHERE a.facility_id = p_facility_id
                UNION SELECT v_f.admin_user_id WHERE v_f.admin_user_id IS NOT NULL) u
    WHERE public.is_demo_account(u.user_id)
    ON CONFLICT (dedupe_key) DO NOTHING;
    -- 근무자: 출석 확인 요청
    IF v_a_uid IS NOT NULL AND v_check IS NOT NULL AND public.is_demo_account(v_a_uid) THEN
      INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data, status, sent_at, created_at)
      VALUES (v_a_uid, 'workroom.check', 'demo-seed:' || p_facility_id::text || ':check:' || v_a_uid::text,
        v_f.name || ' 출석 확인', left(v_check_body, 80) || ' — 앱에서 확인 버튼을 눌러 주세요',
        jsonb_build_object('url', CASE WHEN v_kind = 'gig' THEN '/gig/workroom?facility=' ELSE '/workroom?facility=' END || p_facility_id::text,
          'kind', 'workroom.check', 'facilityId', p_facility_id, 'staffId', v_a, 'checkId', v_check),
        'sent', v_t - make_interval(mins => v_check_mins), v_t - make_interval(mins => v_check_mins))
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'demo notification seed skipped: %', SQLERRM;
  END;

  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_demo_workroom(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_workroom(uuid) TO service_role;

-- ── A④: 시연 로그인 때 그 계정이 볼 사업장의 대화·알림을 지금 기준으로 다시 만든다 ──
CREATE OR REPLACE FUNCTION public.seed_demo_workrooms_for(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE r record; v_n integer := 0;
BEGIN
  IF p_user IS NULL OR NOT public.is_demo_account(p_user) THEN RETURN 0; END IF;
  FOR r IN
    SELECT f.id FROM public.facilities f
    WHERE f.is_demo AND f.is_active AND f.deleted_at IS NULL
      AND (f.name = 'W여성병원'
        OR (f.business_registration_number = 'DEMO-TARGET-0026' AND f.facility_type = 'care_hospital')
        OR f.business_registration_number IN ('DEMO-TARGET-PHARMACY', 'DEMO-GIGWORKER-2026'))
      AND (f.admin_user_id = p_user OR EXISTS (
        SELECT 1 FROM public.facility_admin_access a WHERE a.facility_id = f.id AND a.user_id = p_user))
  LOOP
    BEGIN
      PERFORM public.seed_demo_workroom(r.id); v_n := v_n + 1;
    EXCEPTION WHEN others THEN RAISE WARNING 'seed_demo_workroom skipped: %', SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_demo_workrooms_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_workrooms_for(uuid) TO service_role;

SELECT * FROM public.seed_demo_workrooms();
