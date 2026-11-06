-- 2026-11-06 시연 정리 2건 (docs/QA_2026-11-05_병원_4인.md '남은 것', wip 11/05 단기 시연 '이미 수락' 문제)
-- ① 시연 계정 알림함의 QA 잔재("QA-1105 … 테스트예요") 삭제, 옛 표현 '시프트' → '근무' (시연 계정만)
-- ② 단기 시연이 '이미 수락'에서 안 풀림: 15분 크론 refresh_demo_worker_readiness 가 고정 시연 근무자 행(…0004)의 updated_at 을
--    매번 갱신 → reset_gigworker_invite_demo 의 '최근 1시간 시연 있음'(fs.updated_at > now()-1h) 판정이 늘 참 → 초기화가 연결을 안 풂.
--    크론은 updated_at 을 건드리지 않게 하고(수락 때만 claim_facility_staff_invite 가 갱신), 초기화 때 terms_snapshot 도 비운다
--    ("2026-10-14에 수락한 조건" 잔상). 지금 걸려 있는 행은 updated_at 을 2시간 전으로 돌려 다음 방문에 초기화되게 한다.

-- ── ① 시연 알림함 정리
DO $inbox$
BEGIN
  BEGIN
    DELETE FROM public.notification_reads r
    USING public.notification_outbox n, auth.users u
    WHERE r.notification_id = n.id AND n.worker_auth_user_id = u.id AND u.email LIKE '%@demo.atman.co.kr'
      AND (n.body ~ '^\[?QA-1[01][0-9]{2}' OR n.title ~ 'QA-1[01][0-9]{2}' OR n.body LIKE '%테스트예요%');
    DELETE FROM public.notification_outbox n
    USING auth.users u
    WHERE n.worker_auth_user_id = u.id AND u.email LIKE '%@demo.atman.co.kr'
      AND (n.body ~ '^\[?QA-1[01][0-9]{2}' OR n.title ~ 'QA-1[01][0-9]{2}' OR n.body LIKE '%테스트예요%');
  EXCEPTION WHEN others THEN RAISE NOTICE 'demo_inbox_cleanup: QA 알림 삭제 건너뜀 — %', SQLERRM;
  END;
  BEGIN
    UPDATE public.notification_outbox n
    SET title = replace(n.title, '시프트', '근무'), body = replace(n.body, '시프트', '근무')
    FROM auth.users u
    WHERE n.worker_auth_user_id = u.id AND u.email LIKE '%@demo.atman.co.kr'
      AND (n.title LIKE '%시프트%' OR n.body LIKE '%시프트%');
  EXCEPTION WHEN others THEN RAISE NOTICE 'demo_inbox_cleanup: 시프트 표현 교체 건너뜀 — %', SQLERRM;
  END;
END $inbox$;

-- ── ② 크론이 고정 시연 근무자 행의 updated_at 을 갱신하지 않게 (런타임 패치 — 원문 20261022150000)
DO $cron$
DECLARE r record; v_def text; v_new text; v_hit boolean := false;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'refresh_demo_worker_readiness' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def NOT LIKE '%work_weekdays=ARRAY[1,2,3,4,5,6,7],updated_at=now()%' THEN
      IF v_def LIKE '%work_weekdays=ARRAY[1,2,3,4,5,6,7]%' THEN v_hit := true; END IF;  -- 이미 패치됨
      CONTINUE;
    END IF;
    v_new := replace(v_def, 'work_weekdays=ARRAY[1,2,3,4,5,6,7],updated_at=now()', 'work_weekdays=ARRAY[1,2,3,4,5,6,7]');
    EXECUTE v_new; v_hit := true;
  END LOOP;
  IF NOT v_hit THEN RAISE EXCEPTION 'demo_gig_reset: refresh_demo_worker_readiness source drifted'; END IF;
END $cron$;

-- ── ② 초기화 때 수락 조건 스냅샷도 비움 (런타임 패치 — 원문 20260928113000, 20261014200000 에서 _internal 로 이름 변경)
DO $reset$
DECLARE r record; v_def text; v_new text; v_hit boolean := false;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'reset_gigworker_invite_demo_internal' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%terms_snapshot=NULL%' THEN v_hit := true; CONTINUE; END IF;
    v_new := replace(v_def, E'worker_id=NULL,name=v_worker.name,phone=NULL,status=''active'',', E'worker_id=NULL,terms_snapshot=NULL,name=v_worker.name,phone=NULL,status=''active'',');
    IF v_new <> v_def THEN EXECUTE v_new; v_hit := true; END IF;
  END LOOP;
  IF NOT v_hit THEN RAISE NOTICE 'demo_gig_reset: reset_gigworker_invite_demo_internal 앵커 없음 — terms_snapshot 비우기 건너뜀'; END IF;
END $reset$;

-- ── ② 지금 걸려 있는 상태 풀기: 출근 중이 아니면 '최근 시연' 창 밖으로 (다음 방문자의 초기화가 연결을 푼다)
UPDATE public.facility_staff fs SET updated_at = now() - interval '2 hours'
WHERE fs.id = '20260922-0000-4000-8000-000000000004'::uuid
  AND fs.updated_at > now() - interval '1 hour'
  AND NOT EXISTS (SELECT 1 FROM public.staff_attendances a WHERE a.staff_id = fs.id AND a.check_in_at IS NOT NULL AND a.check_out_at IS NULL);

-- 확인
SELECT
  (SELECT count(*) FROM public.notification_outbox n JOIN auth.users u ON u.id = n.worker_auth_user_id
     WHERE u.email LIKE '%@demo.atman.co.kr' AND (n.body ~ '^\[?QA-1[01][0-9]{2}' OR n.body LIKE '%테스트예요%')) AS qa_notices_left,
  position('updated_at=now()' in substring(pg_get_functiondef('public.refresh_demo_worker_readiness()'::regprocedure) from 'UPDATE public.facility_staff fs SET.*')) = 0 AS cron_no_longer_bumps_staff,
  (SELECT updated_at < now() - interval '1 hour' FROM public.facility_staff WHERE id = '20260922-0000-4000-8000-000000000004'::uuid) AS gig_demo_resettable;
