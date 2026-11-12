-- 2026-11-12 토요일 영업 전 시연 정리 (사용자 승인: "2,3 진행 하고 새로 시연 데이터 넣자")
-- ① 하단 탭이 '대화'가 되면서 DB가 만드는 '워크룸' 문구를 '대화방'으로 (함수 안 문구 + 이미 쌓인 시스템 문구·알림 제목)
-- ② 시연 사업장에 남은 QA 흔적 삭제 ([QA] 대화방 안내, QA 채팅·알림)
-- ③ 시연 이름: 직원 이름 뒤 "(데모)", 시연 근무자 계정 이름(…데모워커·데모간호사·긱워커 데모 등), 사업장 이름의 '데모'
--    + 앱으로 연결된 시연 직원 이름 = 그 계정 이름 ("수락한 계정 이름이 달라요" 경고가 시연에 뜨지 않게)
-- ④ 시연 근태·연차 메모의 "데모:" 꼬리표
-- ⑤ 네 시연(병원 W여성병원·요양 수원요양병원·약국·단기 팝업스토어)에 공지·1:1 대화·출석 확인을 새로 넣는다.
--    직원은 매일 08:30 다시 만들어져 1:1 대화가 CASCADE 로 지워지므로, 아침 되살리기 끝과 단기 시연 정리 끝에서 다시 부른다.
--    읽음 표시는 '지금 − 45분'으로 맞춰 최근 근무자 메시지 1~2건이 하단 '대화' 탭 숫자로 보이게 한다.
-- 시연 사업장(is_demo)과 시연 계정만 건드린다. 실사용 데이터는 ①의 시스템 문구·알림 제목 말고는 바꾸지 않는다.

-- ── ① 워크룸 → 대화방 ───────────────────────────────────────────────────────
DO $room$
DECLARE r record; v_def text; v_n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc LIKE '%워크룸%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    EXECUTE replace(v_def, '워크룸', '대화방');
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'room rename: % functions', v_n;
END $room$;

DO $room_rows$
BEGIN
  -- 시스템이 쓴 안내만 (사람이 쓴 메시지는 그대로 둔다)
  UPDATE public.facility_workroom_messages SET body = replace(body, '워크룸', '대화방')
  WHERE sender_type = 'system' AND body LIKE '%워크룸%';
  -- 알림 제목은 시스템이 만든다 ("○○ 워크룸", "○○ 워크룸 참여"). 본문은 사람이 쓴 메시지 앞부분이라 그대로.
  UPDATE public.notification_outbox SET title = replace(title, '워크룸', '대화방')
  WHERE title LIKE '%워크룸%';
EXCEPTION WHEN others THEN RAISE WARNING 'room rows rename skipped: %', SQLERRM;
END $room_rows$;

-- ── ② QA 흔적 (시연 사업장·시연 계정만) ─────────────────────────────────────
DO $qa$
BEGIN
  BEGIN
    DELETE FROM public.facility_workroom_messages m USING public.facilities f
    WHERE m.facility_id = f.id AND f.is_demo AND (m.body ~ '\mQA\M' OR m.sender_name ~ '\mQA\M');
  EXCEPTION WHEN others THEN RAISE WARNING 'qa workroom cleanup skipped: %', SQLERRM;
  END;
  BEGIN
    DELETE FROM public.chat_messages m
    USING public.shift_applications a, public.shifts s, public.facilities f
    WHERE m.application_id = a.id AND a.shift_id = s.id AND s.facility_id = f.id AND f.is_demo
      AND m.body ~ '\mQA\M';
  EXCEPTION WHEN others THEN RAISE WARNING 'qa chat cleanup skipped: %', SQLERRM;
  END;
  BEGIN
    DELETE FROM public.notification_outbox n
    WHERE public.is_demo_account(n.worker_auth_user_id) AND (n.title ~ '\mQA\M' OR n.body ~ '\mQA\M');
  EXCEPTION WHEN others THEN RAISE WARNING 'qa notification cleanup skipped: %', SQLERRM;
  END;
END $qa$;

-- ── ③ 시연 이름 ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE _demo_renames(old_name text PRIMARY KEY, new_name text NOT NULL);

DO $names$
DECLARE
  -- 시연 직원 이름(김민서·박서윤·이민준·최하은·정도윤·김서현·이지은·박하늘, 단기 김하늘·이준호·박서연·최민재·정유진)과 겹치지 않게
  v_pool text[] := ARRAY['윤서연','송민재','오하린','강도현','임수아','장예준','서지아','권태윤','조은채','황시우',
                         '문가은','배지호','신유나','유건우','노하윤','안지훈','홍채원','전우진','고나연','류현우',
                         '차은서','구민혁','성다인','엄태호','진소율','하준서','양서윤','남지원','석예린','심승민',
                         '천보람','원유진','지현서','명다은','설재윤','변수빈','방지성','염하은','어준혁','함시은'];
BEGIN
  -- 시연 근무자 계정: 이름에 데모·시연·긱워커·QA 가 들어간 것만 사람 이름으로. 단기 시연 근무자는 한지우로 고정(QA 스크립트가 찾는다).
  INSERT INTO _demo_renames(old_name, new_name)
  SELECT name, '한지우' FROM public.workers
  WHERE is_demo AND deleted_at IS NULL AND name = '긱워커 데모'
  LIMIT 1;
  INSERT INTO _demo_renames(old_name, new_name)
  SELECT name, v_pool[((row_number() OVER (ORDER BY first_kakao NULLS LAST, name) - 1) % array_length(v_pool, 1)) + 1]
  FROM (SELECT name, min(kakao_id) AS first_kakao FROM public.workers
        WHERE is_demo AND deleted_at IS NULL AND name ~ '(데모|시연|긱워커|\mQA\M)' AND name <> '긱워커 데모'
        GROUP BY name) d
  ON CONFLICT (old_name) DO NOTHING;

  UPDATE public.workers w SET name = r.new_name
  FROM _demo_renames r WHERE w.is_demo AND w.name = r.old_name;

  BEGIN
    UPDATE public.worker_bank_accounts b SET account_holder_name = r.new_name
    FROM public.workers w, _demo_renames r
    WHERE b.worker_id = w.id AND w.is_demo AND b.account_holder_name = r.old_name;
  EXCEPTION WHEN others THEN RAISE WARNING 'demo bank holder rename skipped: %', SQLERRM;
  END;

  -- 시연 사업장 이름
  UPDATE public.facilities SET name = '수원 온누리약국' WHERE is_demo AND name = '수원 온누리 데모약국';
  UPDATE public.facilities SET name = '잇닿 팝업스토어' WHERE is_demo AND name = '잇닿 팝업스토어 데모';
  INSERT INTO _demo_renames VALUES ('수원 온누리 데모약국', '수원 온누리약국'), ('잇닿 팝업스토어 데모', '잇닿 팝업스토어')
  ON CONFLICT (old_name) DO NOTHING;

  -- 단기 요금제 이름 (문구 규칙: '워커' 대신 근무자·단기)
  UPDATE public.service_plans SET name = '단기·행사 근태 무료 베타' WHERE code = 'gigworker_trial' AND name = '긱워커 근태 무료 베타';

  -- 시연 직원: "(데모)" 떼고, 옛 계정 이름 그대로인 직원은 새 이름으로, 앱으로 연결된 시연 계정이 있으면 그 계정 이름으로
  UPDATE public.facility_staff s SET name = replace(s.name, ' (데모)', '')
  FROM public.facilities f WHERE f.id = s.facility_id AND f.is_demo AND s.name LIKE '% (데모)%';
  UPDATE public.facility_staff s SET name = r.new_name
  FROM public.facilities f, _demo_renames r WHERE f.id = s.facility_id AND f.is_demo AND s.name = r.old_name;
  UPDATE public.facility_staff s SET name = w.name
  FROM public.facilities f, public.workers w
  WHERE f.id = s.facility_id AND f.is_demo AND w.id = s.worker_id AND w.is_demo
    AND NULLIF(btrim(w.name), '') IS NOT NULL AND s.name IS DISTINCT FROM w.name;
END $names$;

-- 이미 쌓인 시연 대화방·알림 문구 속 옛 이름
DO $name_rows$
DECLARE r record;
BEGIN
  FOR r IN SELECT old_name, new_name FROM _demo_renames LOOP
    UPDATE public.facility_workroom_messages m SET body = replace(m.body, r.old_name, r.new_name), sender_name = replace(m.sender_name, r.old_name, r.new_name)
    FROM public.facilities f WHERE f.id = m.facility_id AND f.is_demo AND (m.body LIKE '%' || r.old_name || '%' OR m.sender_name LIKE '%' || r.old_name || '%');
    UPDATE public.notification_outbox n SET title = replace(n.title, r.old_name, r.new_name), body = replace(n.body, r.old_name, r.new_name)
    WHERE public.is_demo_account(n.worker_auth_user_id) AND (n.title LIKE '%' || r.old_name || '%' OR n.body LIKE '%' || r.old_name || '%');
    UPDATE public.chat_messages m SET body = replace(m.body, r.old_name, r.new_name)
    FROM public.shift_applications a, public.shifts s, public.facilities f
    WHERE m.application_id = a.id AND a.shift_id = s.id AND s.facility_id = f.id AND f.is_demo
      AND m.sender_type = 'system' AND m.body LIKE '%' || r.old_name || '%';
  END LOOP;
  UPDATE public.facility_workroom_messages m SET body = replace(m.body, ' (데모)', ''), sender_name = replace(m.sender_name, ' (데모)', '')
  FROM public.facilities f WHERE f.id = m.facility_id AND f.is_demo AND (m.body LIKE '% (데모)%' OR m.sender_name LIKE '% (데모)%');
  UPDATE public.notification_outbox n SET title = replace(n.title, ' (데모)', ''), body = replace(n.body, ' (데모)', '')
  WHERE public.is_demo_account(n.worker_auth_user_id) AND (n.title LIKE '% (데모)%' OR n.body LIKE '% (데모)%');
EXCEPTION WHEN others THEN RAISE WARNING 'demo name rows skipped: %', SQLERRM;
END $name_rows$;
DROP TABLE IF EXISTS _demo_renames;

-- ── ④ 시연 함수: 다음 되살리기부터 같은 이름·메모로 ───────────────────────────
DO $fn$
DECLARE r record; v_def text; v_new text; v_n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname LIKE '%demo%'
      AND p.prosrc ~ '(\(데모\)|''데모(:| 월간:|용) )'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    IF r.proname = 'refresh_demo_clinic_workforce' THEN
      -- 앱 연결 직원(1번 자리)은 연결된 시연 계정 이름을 쓴다
      IF position('SELECT id, row_number() OVER (ORDER BY kakao_id) AS rn' IN v_new) > 0
         AND position('t.name || '' (데모)'',' IN v_new) > 0 THEN
        v_new := replace(v_new, 'SELECT id, row_number() OVER (ORDER BY kakao_id) AS rn', 'SELECT id, name, row_number() OVER (ORDER BY kakao_id) AS rn');
        v_new := replace(v_new, 't.name || '' (데모)'',', 'CASE WHEN t.slot_no = 1 THEN COALESCE(NULLIF(btrim(w.name), ''''), t.name) ELSE t.name END,');
      ELSE
        RAISE WARNING 'refresh_demo_clinic_workforce: 연결 직원 이름 패치 자리를 못 찾음 (꼬리표만 뗀다)';
      END IF;
    ELSIF r.proname = 'refresh_demo_pharmacy_workforce' THEN
      v_new := replace(v_new, '(v_ph, v_worker, ''김서현 (데모)''',
        '(v_ph, v_worker, COALESCE((SELECT NULLIF(btrim(x.name), '''') FROM public.workers x WHERE x.id = v_worker), ''김서현'')');
      v_new := replace(v_new, '(v_ph, v_staff_worker, ''박하늘 (데모)''',
        '(v_ph, v_staff_worker, COALESCE((SELECT NULLIF(btrim(x.name), '''') FROM public.workers x WHERE x.id = v_staff_worker), ''박하늘'')');
    END IF;
    v_new := replace(v_new, ' || '' (데모)''', '');
    v_new := replace(v_new, ' (데모)''', '''');
    v_new := replace(v_new, '''데모 월간: ', '''');
    v_new := replace(v_new, '''데모: ', '''');
    v_new := replace(v_new, '''데모용 ', '''');
    v_new := replace(v_new, '''승인 휴가''', '''승인 연차''');
    IF v_new <> v_def THEN EXECUTE v_new; v_n := v_n + 1; END IF;
  END LOOP;
  RAISE NOTICE 'demo function labels: % functions', v_n;
END $fn$;

-- 지금 있는 시연 근태·연차 메모도 같이 (다음 08:30 되살리기를 기다리지 않게)
DO $notes$
BEGIN
  UPDATE public.staff_attendances a SET note = replace(regexp_replace(a.note, '^데모( 월간)?: ?|^데모용 ', ''), '승인 휴가', '승인 연차')
  FROM public.facilities f WHERE f.id = a.facility_id AND f.is_demo AND a.note ~ '^데모';
  UPDATE public.staff_leave_balances b SET note = regexp_replace(b.note, '^데모( 월간)?: ?|^데모용 ', '')
  FROM public.facilities f WHERE f.id = b.facility_id AND f.is_demo AND b.note ~ '^데모';
  UPDATE public.staff_leave_requests l SET reason = regexp_replace(l.reason, '^데모( 월간)?: ?|^데모용 ', '')
  FROM public.facilities f WHERE f.id = l.facility_id AND f.is_demo AND l.reason ~ '^데모';
EXCEPTION WHEN others THEN RAISE WARNING 'demo notes skipped: %', SQLERRM;
END $notes$;

-- ── ⑤ 시연 대화 ─────────────────────────────────────────────────────────────
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
  v_b uuid; v_b_name text; v_b_uid uuid;
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

  -- 앱으로 연결된 시연 직원 (근무자 메시지는 연결된 사람만 보낼 수 있다)
  SELECT s.id, s.name, w.auth_user_id, w.id INTO v_a, v_a_name, v_a_uid, v_a_worker
  FROM public.facility_staff s JOIN public.workers w ON w.id = s.worker_id
  WHERE s.facility_id = p_facility_id AND s.status = 'active' AND w.auth_user_id IS NOT NULL
  ORDER BY s.phone NULLS LAST, s.created_at, s.id LIMIT 1;
  IF v_kind = 'gig' AND v_a IS NULL THEN
    -- 근무자 시연을 막 초기화해 연결이 풀린 순간에도 고정 근무자와의 대화는 보이게
    SELECT s.id, s.name INTO v_a, v_a_name FROM public.facility_staff s
    WHERE s.id = '20260922-0000-4000-8000-000000000004' AND s.facility_id = p_facility_id;
  END IF;
  SELECT s.id, s.name, w.auth_user_id INTO v_b, v_b_name, v_b_uid
  FROM public.facility_staff s JOIN public.workers w ON w.id = s.worker_id
  WHERE s.facility_id = p_facility_id AND s.status = 'active' AND w.auth_user_id IS NOT NULL AND s.id <> COALESCE(v_a, gen_random_uuid())
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
    AND (r.sender = 'admin' OR (r.sender = 'a' AND v_a_uid IS NOT NULL) OR (r.sender = 'b' AND v_b_uid IS NOT NULL));
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

CREATE OR REPLACE FUNCTION public.seed_demo_workrooms()
RETURNS TABLE(facility text, messages integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT f.id, f.name FROM public.facilities f
    WHERE f.is_demo AND f.is_active AND f.deleted_at IS NULL
      AND (f.name = 'W여성병원'
        OR (f.business_registration_number = 'DEMO-TARGET-0026' AND f.facility_type = 'care_hospital')
        OR f.business_registration_number IN ('DEMO-TARGET-PHARMACY', 'DEMO-GIGWORKER-2026'))
    ORDER BY f.business_registration_number
  LOOP
    BEGIN
      facility := r.name; messages := public.seed_demo_workroom(r.id); RETURN NEXT;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'seed_demo_workroom % skipped: %', r.name, SQLERRM;
      facility := r.name; messages := -1; RETURN NEXT;
    END;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_demo_workrooms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_demo_workrooms() TO service_role;

-- 단기 시연 정리: 근무 건과 함께 대화도 다시 만든다 (정리가 대화방을 비우므로)
CREATE OR REPLACE FUNCTION public.cleanup_gig_demo_facility(p_keep_staff uuid, p_keep_invite uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility uuid;
BEGIN
  SELECT id INTO v_facility FROM public.facilities
  WHERE business_registration_number = 'DEMO-GIGWORKER-2026' AND is_demo = true;
  IF v_facility IS NULL THEN RETURN; END IF;

  -- 대화방: 공지·대화·확인 요청 전부 (9/22부터 쌓인 자동 근태 알림 포함)
  DELETE FROM public.facility_workroom_messages WHERE facility_id = v_facility;
  DELETE FROM public.facility_workroom_checks WHERE facility_id = v_facility;
  -- 방문자가 만든 초대·근무자 (고정 시드 제외). 지급·배정·근태·계좌 전달은 CASCADE
  DELETE FROM public.facility_staff_invites WHERE facility_id = v_facility AND id <> p_keep_invite;
  DELETE FROM public.facility_staff WHERE facility_id = v_facility AND id <> p_keep_staff;
  -- 참여자가 아무도 없는 근무 건 (방문자가 만든 QA-… 등). 고정 근무자가 배정된 건은 남는다
  DELETE FROM public.gig_projects p
  WHERE p.facility_id = v_facility
    AND NOT EXISTS (SELECT 1 FROM public.gig_assignments a WHERE a.project_id = p.id);

  -- 시연용 근무 건 3개를 다시 만든다(2026-11-12)
  BEGIN
    PERFORM public.seed_gig_demo_projects();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_gig_demo_projects skipped: %', SQLERRM;
  END;
  -- 시연 대화(공지·1:1·출석 확인)를 다시 넣는다(2026-11-12)
  BEGIN
    PERFORM public.seed_demo_workroom(v_facility);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_demo_workroom skipped: %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_gig_demo_facility(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_gig_demo_facility(uuid, uuid) TO service_role;

SELECT * FROM public.seed_demo_workrooms();
