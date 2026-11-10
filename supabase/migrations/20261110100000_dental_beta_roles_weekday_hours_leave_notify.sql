-- 치과 의원 베타 준비 (2026-11-10 3인 QA, docs/QA_2026-11-10_치과_3인.md)
--
--   ① 직종 '치과위생사'(dental_hygienist) — 직원 명부·근무자 가입·공고 자격에서 고를 수 있게 한다.
--      지금까지는 '기타'로 넣어야 했고 근무자 앱에 '기타 직군'으로 보였다.
--   ② 요일별 근무시간(facility_staff.weekday_hours) — 토요일 09~13시, 야간진료 요일처럼 하루만 시간이 다른 직원.
--      지금까지는 직원당 출근·퇴근 한 쌍뿐이라 토요일 13시 퇴근이 TIME_NOT_ALLOWED 이거나 매주 조퇴로 잡혔다.
--      출퇴근 판정(record_unified_attendance)·출근 리마인더·미출근 알림이 그 근무일의 요일 값을 쓴다.
--   ③ 휴가 신청 알림 — 직원이 휴가를 신청하면 사업장 관리자에게 알린다. 지금까지는 관리자가 화면을 열어야만 알 수 있었다.
--
-- 기존 행은 weekday_hours='{}' 이라 동작이 달라지지 않는다.
-- 함수 본문은 여러 번 문자열 치환으로 고쳐 온 이력이 있어(9/21·9/22·9/29·10/14) 원본 파일이 아니라 살아 있는 정의를 받아 고친다.
-- 치환 지점을 찾지 못하면 예외로 멈추고, 마이그레이션 전체가 되돌려진다.

-- ── ① 직종 추가 ────────────────────────────────────────────────────────────
INSERT INTO public.job_categories (code, name_ko, sector)
VALUES ('dental_hygienist', '치과위생사', 'healthcare')
ON CONFLICT (code) DO UPDATE
  SET name_ko = EXCLUDED.name_ko, sector = EXCLUDED.sector, is_active = true;

ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_role_check;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_role_check
  CHECK (role IN ('rn','na','pharmacist','pharmacy_staff','care_worker','dental_hygienist','other'));

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_required_role_check;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_required_role_check
  CHECK (required_role IN ('rn','na','pharmacist','pharmacy_staff','care_worker','dental_hygienist','other','any'));

ALTER TABLE public.shift_templates DROP CONSTRAINT IF EXISTS shift_templates_required_role_check;
ALTER TABLE public.shift_templates
  ADD CONSTRAINT shift_templates_required_role_check
  CHECK (required_role IN ('rn','na','pharmacist','pharmacy_staff','care_worker','dental_hygienist','other','any'));

ALTER TABLE public.facility_staff DROP CONSTRAINT IF EXISTS facility_staff_role_check;
ALTER TABLE public.facility_staff
  ADD CONSTRAINT facility_staff_role_check
  CHECK (role IN ('rn','na','pharmacist','pharmacy_staff','care_worker','dental_hygienist','coordinator','admin','other'));

-- 근무자 가입(complete_worker_onboarding)의 직군 검사
DO $role_patch$
DECLARE
  fn regprocedure;
  def text;
  patched text;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_worker_onboarding'
  ORDER BY p.oid DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'complete_worker_onboarding 함수를 찾지 못했습니다'; END IF;
  def := pg_get_functiondef(fn);
  IF position($p$'dental_hygienist'$p$ in def) > 0 THEN RETURN; END IF;
  patched := replace(def,
    $p$IF p_role NOT IN ('rn','na','pharmacist','pharmacy_staff','care_worker','other') THEN$p$,
    $p$IF p_role NOT IN ('rn','na','pharmacist','pharmacy_staff','care_worker','dental_hygienist','other') THEN$p$);
  IF patched = def THEN
    RAISE EXCEPTION '가입 직군 검사 문구를 찾지 못했습니다 — complete_worker_onboarding 본문이 예상과 다릅니다';
  END IF;
  EXECUTE patched;
END;
$role_patch$;

-- ── ② 요일별 근무시간 ──────────────────────────────────────────────────────
-- 모양: {"6": {"start": "09:00", "end": "13:00"}} — 키는 ISO 요일('1'=월 … '7'=일), 값은 HH:MM, 시작 < 종료(야간 넘김 없음).
-- 없는 요일은 default_start_time / default_end_time 을 쓴다.
CREATE OR REPLACE FUNCTION public.is_valid_weekday_hours(p_hours jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_value jsonb;
BEGIN
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'object' THEN RETURN false; END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_hours) LOOP
    IF v_key !~ '^[1-7]$' OR jsonb_typeof(v_value) <> 'object'
       OR COALESCE(v_value->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR COALESCE(v_value->>'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR (v_value->>'start') >= (v_value->>'end') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE public.facility_staff
  ADD COLUMN IF NOT EXISTS weekday_hours jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.facility_staff DROP CONSTRAINT IF EXISTS facility_staff_weekday_hours_check;
ALTER TABLE public.facility_staff
  ADD CONSTRAINT facility_staff_weekday_hours_check CHECK (public.is_valid_weekday_hours(weekday_hours));
COMMENT ON COLUMN public.facility_staff.weekday_hours IS
  '요일별 근무시간. {"6":{"start":"09:00","end":"13:00"}} — 키는 ISO 요일(1=월…7=일). 없는 요일은 default_start_time/default_end_time.';

-- 근무자 앱이 자기 근무시간을 읽는다 (행 RLS 는 기존 facility_staff_worker_read 그대로)
GRANT SELECT (weekday_hours) ON public.facility_staff TO authenticated;

-- 그 날짜에 적용되는 출근·퇴근 시각
CREATE OR REPLACE FUNCTION public.staff_start_time_on(p_default time, p_weekday_hours jsonb, p_date date)
RETURNS time
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE((p_weekday_hours -> (extract(isodow FROM p_date)::int)::text ->> 'start')::time, p_default);
$$;
CREATE OR REPLACE FUNCTION public.staff_end_time_on(p_default time, p_weekday_hours jsonb, p_date date)
RETURNS time
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE((p_weekday_hours -> (extract(isodow FROM p_date)::int)::text ->> 'end')::time, p_default);
$$;
REVOKE ALL ON FUNCTION public.staff_start_time_on(time, jsonb, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_end_time_on(time, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_start_time_on(time, jsonb, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_end_time_on(time, jsonb, date) TO authenticated, service_role;

-- 출퇴근 판정: 근무일을 (기본 시간으로) 정한 직후, 그 요일의 시간을 v_staff 에 덮어쓴다.
-- 뒤따르는 인증 가능 시간·지각·조퇴·예정 시각 기록이 모두 v_staff.default_*_time 을 읽으므로 한 곳만 고치면 된다.
DO $attendance_patch$
DECLARE
  fn regprocedure := to_regprocedure(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'
  );
  def text;
  patched text;
  needle text := $needle$    v_start_at:=(v_work_date+v_staff.default_start_time) AT TIME ZONE 'Asia/Seoul';$needle$;
  replacement text := $replacement$    -- 요일별 근무시간(weekday_hours): 이 근무일 요일에 따로 정한 시간이 있으면 기본 시간 대신 쓴다
    v_staff.default_end_time:=public.staff_end_time_on(v_staff.default_end_time,v_staff.weekday_hours,v_work_date);
    v_staff.default_start_time:=public.staff_start_time_on(v_staff.default_start_time,v_staff.weekday_hours,v_work_date);
    v_start_at:=(v_work_date+v_staff.default_start_time) AT TIME ZONE 'Asia/Seoul';$replacement$;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  def := pg_get_functiondef(fn);
  IF position('staff_start_time_on' in def) > 0 THEN RETURN; END IF;
  patched := replace(def, needle, replacement);
  IF patched = def THEN
    RAISE EXCEPTION '출퇴근 판정의 근무 시작 시각 계산 지점을 찾지 못했습니다 — record_unified_attendance 본문이 예상과 다릅니다';
  END IF;
  EXECUTE patched;
END;
$attendance_patch$;

-- 출근 리마인더: 그 날짜의 출근 시각 기준
DO $reminder_patch$
DECLARE
  fn regprocedure := to_regprocedure('public.enqueue_attendance_reminders_at(timestamp without time zone,integer,integer)');
  def text;
  patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'enqueue_attendance_reminders_at not found'; END IF;
  def := pg_get_functiondef(fn);
  IF position('staff_start_time_on' in def) > 0 THEN RETURN; END IF;
  patched := replace(def, 's.default_start_time',
    'public.staff_start_time_on(s.default_start_time, s.weekday_hours, days.work_date)');
  IF patched = def OR position('days.work_date' in def) = 0 THEN
    RAISE EXCEPTION '출근 리마인더의 출근 시각 지점을 찾지 못했습니다 — enqueue_attendance_reminders_at 본문이 예상과 다릅니다';
  END IF;
  EXECUTE patched;
END;
$reminder_patch$;

-- 미출근 관리자 알림: 오늘의 출근 시각 기준
DO $no_show_patch$
DECLARE
  fn regprocedure := to_regprocedure('public.enqueue_no_show_admin_alerts(integer)');
  def text;
  step text;
  patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'enqueue_no_show_admin_alerts not found'; END IF;
  def := pg_get_functiondef(fn);
  IF position('staff_start_time_on' in def) > 0 THEN RETURN; END IF;
  -- 목록 컬럼은 뒤에서 r.default_start_time 으로 읽으므로 이름을 먼저 붙여 둔다
  step := replace(def,
    'f.name AS facility_name, s.default_start_time',
    'f.name AS facility_name, s.default_start_time AS default_start_time');
  IF step = def OR position('v_today' in def) = 0 THEN
    RAISE EXCEPTION '미출근 알림의 출근 시각 지점을 찾지 못했습니다 — enqueue_no_show_admin_alerts 본문이 예상과 다릅니다';
  END IF;
  patched := replace(step, 's.default_start_time',
    'public.staff_start_time_on(s.default_start_time, s.weekday_hours, v_today)');
  EXECUTE patched;
END;
$no_show_patch$;

-- ── ③ 휴가 신청 → 사업장 관리자 알림 ───────────────────────────────────────
-- 관리자가 직접 등록한 휴가(status='approved' 로 들어옴)는 알리지 않는다. 시연 사업장도 제외.
CREATE OR REPLACE FUNCTION public.enqueue_admin_leave_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text;
  v_is_demo boolean;
  v_type text;
  v_period text;
  v_recipient uuid;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  SELECT COALESCE(f.is_demo, false) INTO v_is_demo FROM public.facilities f WHERE f.id = NEW.facility_id;
  IF COALESCE(v_is_demo, true) THEN RETURN NEW; END IF;
  SELECT s.name INTO v_name FROM public.facility_staff s WHERE s.id = NEW.staff_id;
  v_type := CASE NEW.leave_type
    WHEN 'annual' THEN '연차' WHEN 'half_day' THEN '반차' WHEN 'quarter_day' THEN '반반차'
    WHEN 'hourly' THEN '시간 휴가' WHEN 'sick' THEN '병가' ELSE '휴가' END;
  v_period := to_char(NEW.start_date, 'FMMM/FMDD')
    || CASE WHEN NEW.end_date <> NEW.start_date THEN '~' || to_char(NEW.end_date, 'FMMM/FMDD') ELSE '' END;

  FOR v_recipient IN
    SELECT f.admin_user_id FROM public.facilities f
    WHERE f.id = NEW.facility_id AND f.admin_user_id IS NOT NULL
    UNION
    SELECT fa.user_id FROM public.facility_admin_access fa
    WHERE fa.facility_id = NEW.facility_id AND fa.access_role IN ('owner','operator','super')
  LOOP
    INSERT INTO public.notification_outbox(
      worker_auth_user_id, event_type, dedupe_key, title, body, data
    ) VALUES (
      -- dedupe_key 는 전역 UNIQUE — 수신자를 포함해야 관리자가 2명 이상일 때 유실이 없다
      v_recipient, 'leave.requested', 'leave.requested:' || NEW.id::text || ':' || v_recipient::text,
      '휴가 신청이 들어왔어요',
      format('%s님이 %s %s를 신청했어요. 승인하거나 반려해 주세요.', COALESCE(v_name, '직원'), v_period, v_type),
      jsonb_build_object('url', '/leave', 'kind', 'leave.requested', 'facilityId', NEW.facility_id, 'leaveRequestId', NEW.id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_leave_request ON public.staff_leave_requests;
CREATE TRIGGER trg_admin_leave_request
AFTER INSERT ON public.staff_leave_requests
FOR EACH ROW EXECUTE FUNCTION public.enqueue_admin_leave_request();

REVOKE ALL ON FUNCTION public.enqueue_admin_leave_request() FROM PUBLIC, anon, authenticated;

-- ── 확인 ───────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'facility_staff' AND column_name = 'weekday_hours') AS weekday_hours_col_1,
  (position('staff_start_time_on' in pg_get_functiondef(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'::regprocedure)) > 0) AS attendance_patched_t,
  (position('staff_start_time_on' in pg_get_functiondef(
    'public.enqueue_attendance_reminders_at(timestamp without time zone,integer,integer)'::regprocedure)) > 0) AS reminder_patched_t,
  (position('staff_start_time_on' in pg_get_functiondef('public.enqueue_no_show_admin_alerts(integer)'::regprocedure)) > 0) AS no_show_patched_t,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_admin_leave_request' AND NOT tgisinternal) AS leave_trigger_1,
  public.is_valid_weekday_hours('{"6":{"start":"09:00","end":"13:00"}}'::jsonb) AS valid_t,
  public.is_valid_weekday_hours('{"8":{"start":"09:00","end":"13:00"}}'::jsonb) AS invalid_f;
