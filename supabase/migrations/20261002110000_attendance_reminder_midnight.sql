-- 출근 리마인더 — 자정 전후에 시작하는 근무가 빠지던 것
--
-- 기존 함수는 '시각(time)'만으로 조회 창을 잡고 날짜는 실행 시점의 오늘(v_today)로 고정했다.
-- 10분 주기 크론 기준으로 23:50~00:29 시작 근무가 리마인더를 받지 못했다.
--   · 23:50~23:59 시작: 23:20 실행의 창(23:50~00:00)이 자정을 넘어 'IF v_to < v_from THEN RETURN 0'
--   · 00:00~00:29 시작: 23:30~23:50 실행에서 날짜가 전날로 잡혀 단기 근무(shift_date)가 안 맞고,
--     기존 직원은 요일·휴가·출근 기록을 전날 기준으로 판정했다
-- 날짜+시각(timestamp)으로 창을 잡고, 대상 날짜를 근무 시작 날짜로 쓴다.
--
-- 크론은 run_attendance_reminders() → enqueue_attendance_reminders(30, 10) 을 부른다.
-- 바깥 함수의 이름·인자는 그대로 두고, 계산은 '현재 시각'을 인자로 받는 내부 함수로 옮겨 시험할 수 있게 했다.
-- 자정과 무관한 근무는 대상 날짜 = 오늘이라 중복 방지 키(…:<날짜>)가 예전과 같다 — 배포 직후 중복 발송 없음.

CREATE OR REPLACE FUNCTION public.enqueue_attendance_reminders_at(
  p_now timestamp,                 -- KST 기준 현재 시각
  p_lead_minutes integer DEFAULT 30,
  p_window_minutes integer DEFAULT 10
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_from timestamp := p_now + make_interval(mins => p_lead_minutes);
  v_to   timestamp := p_now + make_interval(mins => p_lead_minutes + p_window_minutes);
  v_count integer := 0;
BEGIN
  -- 1) 기존 직원(사업장 직원 레코드 ↔ 워커 계정 연결). 데모 사업장·데모 워커는 제외.
  --    반복 근무라 날짜 행이 없으므로, 창이 걸치는 날짜(하루 또는 자정을 넘으면 이틀)마다 그날의 출근 시각을 본다.
  WITH days AS (
    SELECT DISTINCT d::date AS work_date FROM unnest(ARRAY[v_from::date, v_to::date]) AS d
  ), targets AS (
    SELECT s.id AS staff_id, w.auth_user_id, f.name AS facility_name, s.default_start_time AS start_at, days.work_date
    FROM public.facility_staff s
    JOIN public.workers w ON w.id = s.worker_id AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL AND w.is_demo = false
    JOIN public.facilities f ON f.id = s.facility_id AND f.is_active = true AND f.deleted_at IS NULL AND f.is_demo = false
    CROSS JOIN days
    WHERE s.status = 'active'
      AND s.default_start_time IS NOT NULL
      AND (days.work_date + s.default_start_time) >= v_from
      AND (days.work_date + s.default_start_time) <  v_to
      AND (s.work_weekdays IS NULL OR cardinality(s.work_weekdays) = 0 OR extract(isodow FROM days.work_date)::smallint = ANY (s.work_weekdays))
      AND (s.contract_start IS NULL OR s.contract_start <= days.work_date)
      AND (s.contract_end IS NULL OR s.contract_end >= days.work_date)
      AND NOT EXISTS (SELECT 1 FROM public.staff_attendances a WHERE a.staff_id = s.id AND a.work_date = days.work_date AND a.check_in_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.staff_leave_requests l WHERE l.staff_id = s.id AND l.status = 'approved' AND days.work_date BETWEEN l.start_date AND l.end_date)
  ), ins AS (
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT t.auth_user_id, 'attendance.reminder', 'attendance.reminder:staff:' || t.staff_id || ':' || t.work_date,
           p_lead_minutes || '분 뒤 출근이에요',
           t.facility_name || ' ' || to_char(t.start_at, 'HH24:MI') || ' 출근 예정이에요. 도착하면 앱에서 출근하기를 눌러 주세요.',
           jsonb_build_object('url', '/workplace', 'kind', 'attendance.reminder', 'staff_id', t.staff_id)
    FROM targets t
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM ins;

  -- 2) 확정된 단기 근무(지원 수락) — 아직 출근 전. 데모 제외.
  WITH targets AS (
    SELECT a.id AS application_id, w.auth_user_id, f.name AS facility_name, sh.start_time AS start_at, sh.shift_date
    FROM public.shift_applications a
    JOIN public.shifts sh ON sh.id = a.shift_id
      AND sh.shift_date BETWEEN v_from::date AND v_to::date
      AND sh.status IN ('open', 'matched', 'in_progress')
    JOIN public.workers w ON w.id = a.worker_id AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL AND w.is_demo = false
    JOIN public.facilities f ON f.id = sh.facility_id AND f.is_active = true AND f.deleted_at IS NULL AND f.is_demo = false
    WHERE a.status = 'accepted' AND a.checked_in_at IS NULL
      AND (sh.shift_date + sh.start_time) >= v_from
      AND (sh.shift_date + sh.start_time) <  v_to
  ), ins AS (
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT t.auth_user_id, 'attendance.reminder', 'attendance.reminder:app:' || t.application_id || ':' || t.shift_date,
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
REVOKE ALL ON FUNCTION public.enqueue_attendance_reminders_at(timestamp, integer, integer) FROM PUBLIC, anon, authenticated;

-- 크론이 부르는 바깥 함수 — 이름·인자·권한 그대로, 현재 시각만 넘긴다
CREATE OR REPLACE FUNCTION public.enqueue_attendance_reminders(p_lead_minutes integer DEFAULT 30, p_window_minutes integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN public.enqueue_attendance_reminders_at(timezone('Asia/Seoul', now()), p_lead_minutes, p_window_minutes);
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_attendance_reminders(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_attendance_reminders(integer, integer) TO service_role;
