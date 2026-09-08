-- 출근 리마인더: 10분마다 "N분 뒤 출근" 대상(기존 직원 + 확정 단기근무)을 알림 큐에 넣고, pg_net으로 발송 API를 즉시 깨운다.
-- Vercel 무료 크론은 하루 1회라 DB 쪽에서 주기 실행한다. 비밀키는 Vault 'cron_secret'(값은 마이그레이션에 없음).
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.enqueue_attendance_reminders(p_lead_minutes integer DEFAULT 30, p_window_minutes integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_now timestamp := timezone('Asia/Seoul', now());
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_from time := (timezone('Asia/Seoul', now()) + make_interval(mins => p_lead_minutes))::time;
  v_to   time := (timezone('Asia/Seoul', now()) + make_interval(mins => p_lead_minutes + p_window_minutes))::time;
  v_count integer := 0;
BEGIN
  -- 자정 넘김 창은 다루지 않는다(새벽 출근은 다음 실행에서 자연히 잡힘)
  IF v_to < v_from THEN RETURN 0; END IF;

  -- 1) 기존 직원(사업장 직원 레코드 ↔ 워커 계정 연결)
  WITH targets AS (
    SELECT s.id AS staff_id, w.auth_user_id, f.name AS facility_name, s.default_start_time AS start_at
    FROM public.facility_staff s
    JOIN public.workers w ON w.id = s.worker_id AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL
    JOIN public.facilities f ON f.id = s.facility_id AND f.is_active = true AND f.deleted_at IS NULL
    WHERE s.status = 'active'
      AND s.default_start_time IS NOT NULL
      AND s.default_start_time >= v_from AND s.default_start_time < v_to
      AND (s.work_weekdays IS NULL OR cardinality(s.work_weekdays) = 0 OR extract(isodow FROM v_today)::smallint = ANY (s.work_weekdays))
      AND (s.contract_start IS NULL OR s.contract_start <= v_today)
      AND (s.contract_end IS NULL OR s.contract_end >= v_today)
      AND NOT EXISTS (SELECT 1 FROM public.staff_attendances a WHERE a.staff_id = s.id AND a.work_date = v_today AND a.check_in_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.staff_leave_requests l WHERE l.staff_id = s.id AND l.status = 'approved' AND v_today BETWEEN l.start_date AND l.end_date)
  ), ins AS (
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT t.auth_user_id, 'attendance.reminder', 'attendance.reminder:staff:' || t.staff_id || ':' || v_today,
           p_lead_minutes || '분 뒤 출근이에요',
           t.facility_name || ' ' || to_char(t.start_at, 'HH24:MI') || ' 출근 예정이에요. 도착하면 앱에서 출근하기를 눌러 주세요.',
           jsonb_build_object('url', '/workplace', 'kind', 'attendance.reminder', 'staff_id', t.staff_id)
    FROM targets t
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM ins;

  -- 2) 확정된 단기 근무(지원 수락) — 아직 출근 전
  WITH targets AS (
    SELECT a.id AS application_id, w.auth_user_id, f.name AS facility_name, sh.start_time AS start_at
    FROM public.shift_applications a
    JOIN public.shifts sh ON sh.id = a.shift_id AND sh.shift_date = v_today AND sh.status IN ('open', 'matched', 'in_progress')
    JOIN public.workers w ON w.id = a.worker_id AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL
    JOIN public.facilities f ON f.id = sh.facility_id AND f.is_active = true AND f.deleted_at IS NULL
    WHERE a.status = 'accepted' AND a.checked_in_at IS NULL
      AND sh.start_time >= v_from AND sh.start_time < v_to
  ), ins AS (
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT t.auth_user_id, 'attendance.reminder', 'attendance.reminder:app:' || t.application_id || ':' || v_today,
           p_lead_minutes || '분 뒤 출근이에요',
           t.facility_name || ' ' || to_char(t.start_at, 'HH24:MI') || ' 근무예요. 도착하면 앱에서 출근하기를 눌러 주세요.',
           jsonb_build_object('url', '/workplace', 'kind', 'attendance.reminder', 'application_id', t.application_id)
    FROM targets t
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ) SELECT v_count + count(*) INTO v_count FROM ins;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_attendance_reminders(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_attendance_reminders(integer, integer) TO service_role;

-- 큐에 넣은 게 있을 때만 발송 API를 깨운다 (Vault 'cron_secret' = admin-web CRON_SECRET)
CREATE OR REPLACE FUNCTION public.run_attendance_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_secret text;
BEGIN
  v_count := public.enqueue_attendance_reminders(30, 10);
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
REVOKE ALL ON FUNCTION public.run_attendance_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_attendance_reminders() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'attendance-reminders-10min';
SELECT cron.schedule('attendance-reminders-10min', '*/10 * * * *', 'SELECT public.run_attendance_reminders();');

SELECT (SELECT count(*) FROM pg_extension WHERE extname='pg_net') AS pg_net_1,
       (SELECT count(*) FROM cron.job WHERE jobname='attendance-reminders-10min') AS cron_1,
       (SELECT count(*) FROM pg_proc WHERE proname IN ('enqueue_attendance_reminders','run_attendance_reminders')) AS fns_2;
