-- ① 미출근 관리자 푸시: 예정 출근 5분 경과·출근 기록 없음·결근/휴가 아님 → 사업장 관리자(소유자+위임)에게 1일 1회
-- ② 시설유형별 출퇴근 인증 기본값: 요양병원(대형 실내)은 반경 100m·정확도 150m, 약국·의원은 30m/80m. 반경 200m 옵션 허용.

ALTER TABLE public.facility_attendance_settings DROP CONSTRAINT IF EXISTS facility_attendance_settings_gps_radius_meters_check;
ALTER TABLE public.facility_attendance_settings ADD CONSTRAINT facility_attendance_settings_gps_radius_meters_check
  CHECK (gps_radius_meters IN (10, 20, 30, 50, 100, 200));

CREATE OR REPLACE FUNCTION public.enqueue_no_show_admin_alerts(p_grace_minutes integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_now timestamp := timezone('Asia/Seoul', now());
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_count integer := 0;
BEGIN
  WITH late_staff AS (
    SELECT s.id AS staff_id, s.name, s.facility_id, f.name AS facility_name, s.default_start_time
    FROM public.facility_staff s
    JOIN public.facilities f ON f.id = s.facility_id AND f.is_active = true AND f.deleted_at IS NULL
    WHERE s.status = 'active' AND s.default_start_time IS NOT NULL
      AND s.default_start_time <= (v_now - make_interval(mins => p_grace_minutes))::time
      AND s.default_start_time >  (v_now - make_interval(mins => p_grace_minutes + 15))::time   -- 최근 15분 창만 (재실행 시 중복은 dedupe)
      AND (s.work_weekdays IS NULL OR cardinality(s.work_weekdays) = 0 OR extract(isodow FROM v_today)::smallint = ANY (s.work_weekdays))
      AND (s.contract_start IS NULL OR s.contract_start <= v_today)
      AND (s.contract_end IS NULL OR s.contract_end >= v_today)
      AND NOT EXISTS (SELECT 1 FROM public.staff_attendances a WHERE a.staff_id = s.id AND a.work_date = v_today AND (a.check_in_at IS NOT NULL OR a.status IN ('absent','leave')))
      AND NOT EXISTS (SELECT 1 FROM public.staff_leave_requests l WHERE l.staff_id = s.id AND l.status = 'approved' AND v_today BETWEEN l.start_date AND l.end_date)
  ), recipients AS (
    SELECT ls.*, u.user_id
    FROM late_staff ls
    JOIN LATERAL (
      SELECT f.admin_user_id AS user_id FROM public.facilities f WHERE f.id = ls.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT a.user_id FROM public.facility_admin_access a WHERE a.facility_id = ls.facility_id AND a.access_role IN ('owner','operator','super')
    ) u ON true
  ), ins AS (
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT r.user_id, 'attendance.no_show',
           'attendance.no_show:' || r.staff_id || ':' || v_today || ':' || r.user_id,
           r.name || ' 미출근 확인이 필요해요',
           r.facility_name || ' ' || to_char(r.default_start_time, 'HH24:MI') || ' 출근 예정인데 아직 기록이 없어요. 연락해 보거나 결근·출근을 직접 처리해 주세요.',
           jsonb_build_object('url', '/timesheet', 'kind', 'attendance.no_show', 'staff_id', r.staff_id, 'facility_id', r.facility_id)
    FROM recipients r
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_no_show_admin_alerts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_no_show_admin_alerts(integer) TO service_role;

-- 10분 크론이 리마인더와 미출근을 함께 처리
CREATE OR REPLACE FUNCTION public.run_attendance_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_secret text;
BEGIN
  v_count := public.enqueue_attendance_reminders(30, 10) + public.enqueue_no_show_admin_alerts(5);
  IF v_count > 0 THEN
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
    IF v_secret IS NOT NULL THEN
      PERFORM net.http_get(
        url := 'https://admin.itdot.co.kr/api/cron/dispatch-notifications',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
        timeout_milliseconds := 8000
      );
    END IF;
  END IF;
  RETURN v_count;
END;
$$;

-- 셀프 등록 시 유형별 인증 기본값 행을 만들어 둔다 (없으면 RPC 기본 30m/80m)
CREATE OR REPLACE FUNCTION public.seed_attendance_settings_for_facility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.facility_attendance_settings (facility_id, authentication_mode, gps_radius_meters, max_gps_accuracy_meters, qr_fallback_enabled)
  VALUES (NEW.id, 'gps_or_qr',
          CASE WHEN NEW.facility_type IN ('care_hospital','general_hospital','nursing_home') THEN 100 ELSE 30 END,
          CASE WHEN NEW.facility_type IN ('care_hospital','general_hospital','nursing_home') THEN 150 ELSE 80 END,
          true)
  ON CONFLICT (facility_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_seed_attendance_settings ON public.facilities;
CREATE TRIGGER trg_seed_attendance_settings AFTER INSERT ON public.facilities FOR EACH ROW EXECUTE FUNCTION public.seed_attendance_settings_for_facility();

SELECT (SELECT count(*) FROM pg_proc WHERE proname IN ('enqueue_no_show_admin_alerts','seed_attendance_settings_for_facility')) AS fns_2,
       (SELECT count(*) FROM pg_trigger WHERE tgname='trg_seed_attendance_settings') AS trg_1;
