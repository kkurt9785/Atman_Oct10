-- ============================================================================
-- 리뷰 P1 수정 2건 (2026-08-11) — 이미 적용된 환경 교정용
-- (원본 20260809100000·20260809230000도 함께 수정됨 — 신규 환경은 원본만으로 OK)
--
-- ① 약국 데모 전월 근태 낮 시간 공백: 08:40 KST workforce refresh가 DEMO 직원을
--    DELETE→재생성하면서 staff_attendances가 CASCADE 삭제되는데, 이력 복원은
--    00:15에만 돌아 08:40~24:15 동안(영업·시연 시간 전체) 월간 이력이 빈다.
--    → 같은 cron 잡에서 refresh_anchor_demo_month_history()를 바로 이어 호출.
-- ② 관리자 근태 알림 유실: notification_outbox.dedupe_key가 전역 UNIQUE인데
--    수신자 무관하게 'admin-attendance:{id}'라 관리자 2명 이상이면 첫 명만 수신.
--    → dedupe_key에 수신자 id를 포함하도록 트리거 함수 문자열 패치 (fail-loud).
-- ============================================================================

-- ① 약국 데모 cron 재등록 (잡이 없으면 unschedule은 0행 — 안전)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demo-pharmacy-workforce-daily';
SELECT cron.schedule(
  'demo-pharmacy-workforce-daily', '40 23 * * *',
  'SELECT public.refresh_demo_pharmacy_workforce(); SELECT public.refresh_anchor_demo_month_history();'
);

-- ② 알림 트리거 함수 패치
DO $patch$
DECLARE
  fn regprocedure := to_regprocedure('public.enqueue_admin_attendance_exception()');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN
    RAISE NOTICE 'enqueue_admin_attendance_exception not found — 20260809230000 미적용 환경, 원본이 수정본이므로 skip';
    RETURN;
  END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE $k$%'admin-attendance:'||NEW.id::text||':'||v_recipient::text%$k$ THEN
    RAISE NOTICE 'already fixed — skip'; RETURN;
  END IF;
  patched := replace(def,
    $a$'admin-attendance:'||NEW.id::text$a$,
    $b$'admin-attendance:'||NEW.id::text||':'||v_recipient::text$b$);
  IF patched = def THEN RAISE EXCEPTION 'dedupe_key anchor not found — 함수 본문 확인 필요'; END IF;
  EXECUTE patched;
END $patch$;

-- 검증 (둘 다 true면 성공. 20260809230000 미적용 환경이면 notify_fanout_fixed는 null)
SELECT
  (SELECT command LIKE '%refresh_anchor_demo_month_history%' FROM cron.job
    WHERE jobname = 'demo-pharmacy-workforce-daily') AS pharmacy_history_chained,
  (SELECT pg_get_functiondef(to_regprocedure('public.enqueue_admin_attendance_exception()'))
    LIKE $k$%||':'||v_recipient::text%$k$) AS notify_fanout_fixed;
