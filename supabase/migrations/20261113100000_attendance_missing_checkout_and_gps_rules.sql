-- 출퇴근 규칙 보강 (2026-11-13) — 결정 기록은 docs/attendance/DECISIONS.md D1~D4
--
-- ① 미퇴근 자동 표시(D1·D2)
--    출근만 하고 퇴근을 안 찍은 기록은 퇴근 가능 시간(예정 종료 + check_out_after_minutes, 기본 120분)이 지나면
--    근무자가 더는 퇴근을 찍을 수 없는데(TIME_NOT_ALLOWED), 지금까지는 관리자가 손대기 전까지 '근무 중'으로 남았다.
--    매시 07분에 그런 기록에 missing_checkout_at 을 찍는다. 상태(status)는 바꾸지 않는다 — 급여·화면·월 마감이
--    status 를 읽으므로 새 상태값을 만들면 영향 범위가 커진다. 관리자가 퇴근시간을 넣으면(check_out_at) 목록에서 빠진다.
--    서버(크론)가 한동안 멈춰도 다음 실행이 밀린 것까지 한 번에 찍는다(조건이 '지금 시각 기준'이라 자연히 따라잡음).
--    조기 퇴근 승인 대기(checkout_requested_at 있음)는 이미 따로 보이므로 찍지 않는다.
--
-- ② GPS 오차 반영(D3)
--    판정을 `거리 ≤ 반경` 에서 `거리 − min(정확도, 반경, 100m) ≤ 반경` 으로 바꾼다. 실내에서 정확도가 40~80m 로 나오는
--    휴대폰이 실제로는 건물 안인데 '범위 밖'으로 떨어지던 것을 줄인다. 정확도 값은 휴대폰이 보내므로 빼는 값을 반경 이하로
--    묶어 어떤 경우에도 반경의 2배를 넘지 않게 한다. 정확도 상한(max_gps_accuracy_meters) 검사는 그대로다.
--
-- ③ 계정(=기기)당 요청 제한(D4)
--    같은 계정이 1분에 10번 넘게 출퇴근을 시도하면 1분 동안 막는다. 막힌 시도는 인증 기록에 남기지 않아서
--    실패마다 가던 관리자 푸시도 늘지 않는다. IP 기준이 아니다 — 병원 Wi-Fi 하나를 여러 직원이 같이 쓰기 때문이다.

-- ---------------------------------------------------------------------------
-- ① 미퇴근 표시 칸과 찾기용 인덱스
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff_attendances ADD COLUMN IF NOT EXISTS missing_checkout_at timestamptz;
ALTER TABLE public.shift_attendances ADD COLUMN IF NOT EXISTS missing_checkout_at timestamptz;
COMMENT ON COLUMN public.staff_attendances.missing_checkout_at IS
  '퇴근 가능 시간이 지나도록 퇴근 기록이 없어 시스템이 미퇴근으로 표시한 시각. 관리자가 퇴근시간을 넣으면 check_out_at 이 채워져 조치 목록에서 빠진다.';
COMMENT ON COLUMN public.shift_attendances.missing_checkout_at IS
  '퇴근 가능 시간이 지나도록 퇴근 기록이 없어 시스템이 미퇴근으로 표시한 시각.';

-- 조치 필요 목록은 '표시됐고 아직 퇴근시간이 없는' 기록만 오래된 순으로 읽는다
CREATE INDEX IF NOT EXISTS idx_staff_attendances_missing_checkout
  ON public.staff_attendances(facility_id, work_date)
  WHERE missing_checkout_at IS NOT NULL AND check_out_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shift_attendances_missing_checkout
  ON public.shift_attendances(shift_id)
  WHERE missing_checkout_at IS NOT NULL AND check_out_at IS NULL;
-- 표시 작업이 매시간 훑는 '출근했고 퇴근 없는' 기록
CREATE INDEX IF NOT EXISTS idx_staff_attendances_open
  ON public.staff_attendances(work_date)
  WHERE check_in_at IS NOT NULL AND check_out_at IS NULL AND checkout_requested_at IS NULL AND missing_checkout_at IS NULL;

-- ---------------------------------------------------------------------------
-- ① 미퇴근 표시 함수 — 시각을 인자로 받아 시험할 수 있게 하고, 크론은 바깥 함수를 부른다
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_missing_checkouts_at(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_staff integer := 0;
  v_shift integer := 0;
BEGIN
  -- 직원: 기록에 저장된 그날 예정 시간(요일별 시간 반영됨)으로 종료 시각을 만든다.
  -- 종료가 시작보다 이르거나 같으면 다음 날 끝나는 야간 근무다(record_unified_attendance 와 같은 규칙).
  -- 예정 시간이 비어 있는 기록(예전 수동 기록 등)은 출근 후 18시간을 기준으로 한다.
  UPDATE public.staff_attendances a
     SET missing_checkout_at = p_now
   WHERE a.check_in_at IS NOT NULL
     AND a.check_out_at IS NULL
     AND a.checkout_requested_at IS NULL
     AND a.missing_checkout_at IS NULL
     AND p_now > CASE
       WHEN a.scheduled_start IS NOT NULL AND a.scheduled_end IS NOT NULL THEN
         ((a.work_date + a.scheduled_end
           + CASE WHEN a.scheduled_end <= a.scheduled_start THEN interval '1 day' ELSE interval '0' END)
          AT TIME ZONE 'Asia/Seoul')
         + COALESCE((SELECT s.check_out_after_minutes FROM public.facility_attendance_settings s
                      WHERE s.facility_id = a.facility_id), 120) * interval '1 minute'
       ELSE a.check_in_at + interval '18 hours'
     END;
  GET DIAGNOSTICS v_staff = ROW_COUNT;

  -- 공고 근무: 시프트 날짜·종료 시각(야간이면 다음 날)으로 같은 기준을 쓴다
  UPDATE public.shift_attendances a
     SET missing_checkout_at = p_now
    FROM public.shifts sh
   WHERE sh.id = a.shift_id
     AND a.check_in_at IS NOT NULL
     AND a.check_out_at IS NULL
     AND a.checkout_requested_at IS NULL
     AND a.missing_checkout_at IS NULL
     AND p_now > ((sh.shift_date + sh.end_time
                   + CASE WHEN sh.is_overnight THEN interval '1 day' ELSE interval '0' END)
                  AT TIME ZONE 'Asia/Seoul')
       + COALESCE((SELECT s.check_out_after_minutes FROM public.facility_attendance_settings s
                    WHERE s.facility_id = sh.facility_id), 120) * interval '1 minute';
  GET DIAGNOSTICS v_shift = ROW_COUNT;

  RETURN v_staff + v_shift;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_missing_checkouts()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$ SELECT public.mark_missing_checkouts_at(now()); $function$;

REVOKE ALL ON FUNCTION public.mark_missing_checkouts_at(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_missing_checkouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_missing_checkouts_at(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_missing_checkouts() TO service_role;

-- 매시 07분(UTC 기준이어도 매시간이라 상관없음). 밀린 기록은 이번 한 번에 바로 표시한다.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'attendance-missing-checkout-hourly';
SELECT cron.schedule('attendance-missing-checkout-hourly', '7 * * * *', 'SELECT public.mark_missing_checkouts();');
SELECT public.mark_missing_checkouts() AS missing_checkout_backfilled;

-- ---------------------------------------------------------------------------
-- ③ 요청 제한용 인덱스 (계정별 최근 1분 시도 수)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attendance_auth_logs_user_created
  ON public.attendance_auth_logs(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ②③ record_unified_attendance 패치 (본문은 여러 번 런타임 패치돼 있어 문자열 치환으로 고친다)
-- ---------------------------------------------------------------------------
DO $attendance_patch$
DECLARE
  fn regprocedure := to_regprocedure(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'
  );
  def text;
  patched text;
  gps_needle text := $needle$    v_gps_valid:=v_distance<=v_setting.gps_radius_meters$needle$;
  gps_replacement text := $replacement$    -- GPS 오차(정확도)를 반경과 100m 중 작은 값까지만 거리에서 빼고 판정한다 (docs/attendance/DECISIONS.md D3)
    v_gps_valid:=v_distance-LEAST(COALESCE(v_accuracy,0),v_setting.gps_radius_meters,100)<=v_setting.gps_radius_meters$replacement$;
  rate_needle text := $needle$  IF p_target_type='staff' THEN
    SELECT * INTO v_staff FROM public.facility_staff$needle$;
  rate_replacement text := $replacement$  -- 같은 계정(기기당 계정 하나)이 1분에 10번 넘게 시도하면 잠시 막는다 (D4).
  -- 막힌 시도는 인증 기록에 남기지 않는다 — 실패 기록마다 관리자 푸시가 가기 때문이다.
  IF (SELECT count(*) FROM public.attendance_auth_logs
       WHERE user_id=auth.uid() AND created_at>v_now-interval '1 minute')>=10 THEN
    RETURN jsonb_build_object('ok',false,'reason','RATE_LIMITED','retryAfterSeconds',60,
      'message','시도가 너무 많아요. 1분 뒤에 다시 시도해 주세요.');
  END IF;

  IF p_target_type='staff' THEN
    SELECT * INTO v_staff FROM public.facility_staff$replacement$;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  def := pg_get_functiondef(fn);
  patched := def;

  IF position('LEAST(COALESCE(v_accuracy,0),v_setting.gps_radius_meters,100)' in patched) = 0 THEN
    IF (length(patched) - length(replace(patched, gps_needle, ''))) / length(gps_needle) <> 1 THEN
      RAISE EXCEPTION 'GPS 판정식 위치를 하나로 찾지 못했습니다 — record_unified_attendance 본문이 예상과 다릅니다';
    END IF;
    patched := replace(patched, gps_needle, gps_replacement);
  END IF;

  IF position('RATE_LIMITED' in patched) = 0 THEN
    IF (length(patched) - length(replace(patched, rate_needle, ''))) / length(rate_needle) <> 1 THEN
      RAISE EXCEPTION '요청 제한을 넣을 위치를 하나로 찾지 못했습니다 — record_unified_attendance 본문이 예상과 다릅니다';
    END IF;
    patched := replace(patched, rate_needle, rate_replacement);
  END IF;

  IF patched <> def THEN EXECUTE patched; END IF;
END;
$attendance_patch$;

-- ---------------------------------------------------------------------------
-- 확인
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  def text := pg_get_functiondef(to_regprocedure(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'));
BEGIN
  IF position('LEAST(COALESCE(v_accuracy,0),v_setting.gps_radius_meters,100)' in def) = 0 THEN RAISE EXCEPTION 'GPS 오차 반영 실패'; END IF;
  IF position('RATE_LIMITED' in def) = 0 THEN RAISE EXCEPTION '요청 제한 반영 실패'; END IF;
  IF position('v_accuracy<=v_setting.max_gps_accuracy_meters' in def) = 0 THEN RAISE EXCEPTION '정확도 상한 검사가 사라짐'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='attendance-missing-checkout-hourly') <> 1 THEN
    RAISE EXCEPTION '미퇴근 표시 크론 등록 실패';
  END IF;
  RAISE NOTICE '미퇴근 표시·GPS 오차 반영·요청 제한 적용 완료';
END
$verify$;
