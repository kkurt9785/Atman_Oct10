-- 근무자별 비공개 대화·개인 출석 확인 알림의 URL 을 셸 중립(/workroom?facility=)으로 바꾼다.
-- 이 함수들은 병원·약국 사업장에서도 쓰이는데 URL 이 /gig/workroom 으로 고정돼 있어
-- 의료 워커가 알림을 누르면 긱 셸 가드에 튕겼다. 워커 앱(lib/notification-scope.ts noticeHref)이
-- 긱 셸에서는 /workroom → /gig/workroom 으로 바꿔 열므로 DB 는 의료 기준 경로만 적으면 된다.
DO $patch$
DECLARE
  fn regprocedure;
  def text;
  patched text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.send_staff_workroom_message(uuid,text)'::regprocedure,
    'public.create_staff_workroom_checks(uuid,uuid[],text,timestamptz)'::regprocedure
  ] LOOP
    def := pg_get_functiondef(fn);
    patched := replace(def, $u$'/gig/workroom?facility='$u$, $u$'/workroom?facility='$u$);
    IF patched = def THEN
      RAISE NOTICE '% : 이미 셸 중립 URL 이라 건너뜁니다', fn;
    ELSE
      EXECUTE patched;
    END IF;
  END LOOP;
END
$patch$;

SELECT
  position('/gig/workroom' in pg_get_functiondef('public.send_staff_workroom_message(uuid,text)'::regprocedure)) = 0 AS direct_url_neutral_t,
  position('/gig/workroom' in pg_get_functiondef('public.create_staff_workroom_checks(uuid,uuid[],text,timestamptz)'::regprocedure)) = 0 AS check_url_neutral_t;
