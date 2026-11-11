-- 퇴근 응답의 lateMinutes 바로잡기 (2026-11-11 단기 근로 QA)
--   · record_unified_attendance 는 지각을 '지금 − 예정 출근 − 유예'로 계산해 출근·퇴근 응답 모두에 실어 보낸다.
--     그래서 14:16 출근 예정·15:03 퇴근이면 응답이 lateMinutes 27, 09시 출근·18시 퇴근이면 520이 됐다.
--   · 저장값(staff_attendances.late_minutes)은 출근 때 계산한 것 그대로라 맞다. 틀린 것은 퇴근 응답뿐이다.
--   · 화면은 이미 출근할 때만 지각을 알리도록 고쳤다. 여기서는 응답도 바로잡는다: 출근이 아니면 0.
-- 방식: 운영 함수 정의를 읽어 그 한 줄만 바꾼다. 줄이 정확히 한 번 나오지 않거나 이미 바뀌어 있으면
--       건너뛴다(아무것도 바꾸지 않고 NOTICE 만 남긴다) — 출퇴근 핵심 함수라 어긋난 정의에는 손대지 않는다.
DO $patch$
DECLARE
  fn record;
  def text;
  hits integer;
  old_line text := $o$'lateMinutes',v_late,'earlyLeaveMinutes',v_early$o$;
  new_line text := $n$'lateMinutes',CASE WHEN p_action='check_in' THEN v_late ELSE 0 END,'earlyLeaveMinutes',v_early$n$;
BEGIN
  FOR fn IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_unified_attendance'
  LOOP
    def := pg_get_functiondef(fn.oid);
    IF position(new_line IN def) > 0 THEN
      RAISE NOTICE 'checkout lateMinutes patch skipped: already applied (%)', fn.oid::regprocedure;
      CONTINUE;
    END IF;
    hits := (length(def) - length(replace(def, old_line, ''))) / length(old_line);
    IF hits <> 1 OR position('p_action' IN def) = 0 THEN
      RAISE NOTICE 'checkout lateMinutes patch skipped: found % match(es) in % — left unchanged', hits, fn.oid::regprocedure;
      CONTINUE;
    END IF;
    EXECUTE replace(def, old_line, new_line);
    RAISE NOTICE 'checkout lateMinutes patch applied to %', fn.oid::regprocedure;
  END LOOP;
END $patch$;
