-- 반차에 오전·오후를 남긴다 (2026-11-10 치과원장 QA P1-E).
-- 지금까지 반차는 '4시간'만 저장돼, 원장이 "오전에 빠지는지 오후에 빠지는지"를 메모 칸으로만 알 수 있었다.
--
-- 전부 덧붙이는 변경이다.
--   · staff_leave_requests.half_day_period 열 추가 (NULL = 예전 기록·시간대 모름)
--   · 근무자 신청 submit_staff_leave_request_v3, 관리자 등록 create_approved_staff_leave_v2 를 새로 만든다.
--     예전 함수(submit_staff_leave_request_v2, create_approved_staff_leave)는 그대로 둔다 —
--     휴대폰에 남아 있는 옛 화면이 계속 부르기 때문이다. 옛 함수로 들어온 반차는 half_day_period 가 NULL 이다.
--   · 관리자 알림 문구가 '오전 반차'·'오후 반차'로 나가게 enqueue_admin_leave_request 를 고친다.

ALTER TABLE public.staff_leave_requests
  ADD COLUMN IF NOT EXISTS half_day_period text;

ALTER TABLE public.staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_half_day_period_check;
ALTER TABLE public.staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_half_day_period_check
  CHECK (half_day_period IS NULL OR (leave_type = 'half_day' AND half_day_period IN ('am','pm')));

COMMENT ON COLUMN public.staff_leave_requests.half_day_period IS '반차 시간대: am=오전, pm=오후. 반차가 아니거나 예전 기록이면 NULL';

-- ── ① 근무자 휴가 신청 (v2 본문 + 반차 시간대) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_staff_leave_request_v3(
  p_staff_id uuid, p_leave_type text, p_start_date date, p_end_date date,
  p_hourly_minutes integer DEFAULT NULL, p_reason text DEFAULT NULL,
  p_half_day_period text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;
  v_minutes integer;
  v_id uuid;
BEGIN
  SELECT * INTO v_staff FROM public.facility_staff
  WHERE id = p_staff_id AND worker_id = public.current_worker_id() AND status <> 'ended';
  IF NOT FOUND THEN RAISE EXCEPTION '연결된 직원 정보를 찾지 못했어요.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
     OR p_start_date < (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION '오늘 이후 날짜로 휴가를 신청해 주세요.';
  END IF;
  IF p_leave_type NOT IN ('annual','half_day','quarter_day','hourly','sick','other') THEN
    RAISE EXCEPTION '휴가 유형을 확인해 주세요.';
  END IF;
  IF p_leave_type IN ('half_day','quarter_day','hourly') AND p_end_date <> p_start_date THEN
    RAISE EXCEPTION '부분 휴가는 하루만 신청할 수 있어요.';
  END IF;
  IF p_half_day_period IS NOT NULL AND (p_leave_type <> 'half_day' OR p_half_day_period NOT IN ('am','pm')) THEN
    RAISE EXCEPTION '반차는 오전·오후 중 하나를 골라 주세요.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_leave_requests
    WHERE staff_id = v_staff.id AND status IN ('pending','approved')
      AND start_date <= p_end_date AND end_date >= p_start_date
  ) THEN RAISE EXCEPTION '같은 기간에 이미 대기 또는 승인된 휴가가 있어요.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_attendances
    WHERE staff_id = v_staff.id AND work_date BETWEEN p_start_date AND p_end_date
      AND (check_in_at IS NOT NULL OR check_out_at IS NOT NULL)
  ) THEN RAISE EXCEPTION '이미 출퇴근 기록이 있는 날짜에는 휴가를 신청할 수 없어요.'; END IF;

  v_minutes := public.calculate_staff_leave_minutes(v_staff.id, p_leave_type, p_start_date, p_end_date, p_hourly_minutes);
  INSERT INTO public.staff_leave_requests (facility_id, staff_id, leave_type, start_date, end_date, requested_minutes, reason, status, half_day_period)
  VALUES (v_staff.facility_id, v_staff.id, p_leave_type, p_start_date, p_end_date, v_minutes, nullif(trim(p_reason),''), 'pending', p_half_day_period)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_staff_leave_request_v3(uuid,text,date,date,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_staff_leave_request_v3(uuid,text,date,date,integer,text,text) TO authenticated;

-- ── ② 관리자 휴가 바로 등록 (기존 본문 + 반차 시간대) ──────────────────────
CREATE OR REPLACE FUNCTION public.create_approved_staff_leave_v2(
  p_facility_id uuid,p_staff_id uuid,p_leave_type text,p_start_date date,p_end_date date,
  p_hourly_minutes integer DEFAULT NULL,p_reason text DEFAULT NULL,p_half_day_period text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_staff public.facility_staff%ROWTYPE; v_balance public.staff_leave_balances%ROWTYPE;
  v_minutes integer;v_year integer;v_id uuid;v_deduct boolean;
BEGIN
  IF auth.uid() IS NULL OR public.can_manage_facility(p_facility_id,ARRAY['owner','operator','super']) IS NOT TRUE THEN
    RAISE EXCEPTION '휴가 관리 권한이 없어요.';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<p_start_date THEN
    RAISE EXCEPTION '올바른 휴가 날짜를 선택해 주세요.';
  END IF;
  IF p_half_day_period IS NOT NULL AND (p_leave_type<>'half_day' OR p_half_day_period NOT IN ('am','pm')) THEN
    RAISE EXCEPTION '반차는 오전·오후 중 하나를 골라 주세요.';
  END IF;
  SELECT * INTO v_staff FROM public.facility_staff WHERE id=p_staff_id AND facility_id=p_facility_id AND status<>'ended' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '직원을 찾지 못했어요.'; END IF;
  v_minutes := public.calculate_staff_leave_minutes(p_staff_id,p_leave_type,p_start_date,p_end_date,p_hourly_minutes);
  IF EXISTS(SELECT 1 FROM public.staff_leave_requests WHERE staff_id=p_staff_id AND status IN ('pending','approved')
    AND start_date<=p_end_date AND end_date>=p_start_date) THEN
    RAISE EXCEPTION '같은 기간에 이미 대기 또는 승인된 휴가가 있어요.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.staff_attendances WHERE staff_id=p_staff_id AND work_date BETWEEN p_start_date AND p_end_date
    AND (check_in_at IS NOT NULL OR check_out_at IS NOT NULL)) THEN
    RAISE EXCEPTION '이미 출퇴근 기록이 있는 날짜에는 휴가를 등록할 수 없어요.';
  END IF;
  v_deduct := p_leave_type IN ('annual','half_day','quarter_day','hourly');
  IF v_deduct THEN
    v_year := extract(year FROM p_start_date)::integer;
    SELECT * INTO v_balance FROM public.staff_leave_balances WHERE staff_id=p_staff_id AND leave_year=v_year FOR UPDATE;
    IF NOT FOUND OR v_balance.granted_minutes-v_balance.used_minutes<v_minutes THEN
      RAISE EXCEPTION '잔여 휴가가 부족해 등록할 수 없어요.';
    END IF;
    UPDATE public.staff_leave_balances SET used_minutes=used_minutes+v_minutes,updated_at=now() WHERE id=v_balance.id;
  END IF;
  INSERT INTO public.staff_leave_requests(facility_id,staff_id,leave_type,start_date,end_date,requested_minutes,reason,status,decided_by,decided_at,half_day_period)
  VALUES(p_facility_id,p_staff_id,p_leave_type,p_start_date,p_end_date,v_minutes,nullif(trim(p_reason),''),'approved',auth.uid(),now(),p_half_day_period) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_approved_staff_leave_v2(uuid,uuid,text,date,date,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_approved_staff_leave_v2(uuid,uuid,text,date,date,integer,text,text) TO authenticated;

-- ── ③ 관리자 알림 문구: '오전 반차'·'오후 반차' ────────────────────────────
-- 20261110100000 의 본문 그대로, v_type 의 반차 한 줄만 다르다.
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
    WHEN 'annual' THEN '연차'
    WHEN 'half_day' THEN CASE NEW.half_day_period WHEN 'am' THEN '오전 반차' WHEN 'pm' THEN '오후 반차' ELSE '반차' END
    WHEN 'quarter_day' THEN '반반차'
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

REVOKE ALL ON FUNCTION public.enqueue_admin_leave_request() FROM PUBLIC, anon, authenticated;

-- ── 확인 ───────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_leave_requests' AND column_name = 'half_day_period') AS half_day_period_col_1,
  to_regprocedure('public.submit_staff_leave_request_v3(uuid,text,date,date,integer,text,text)') IS NOT NULL AS worker_rpc_ready,
  to_regprocedure('public.create_approved_staff_leave_v2(uuid,uuid,text,date,date,integer,text,text)') IS NOT NULL AS admin_rpc_ready,
  to_regprocedure('public.submit_staff_leave_request_v2(uuid,text,date,date,integer,text)') IS NOT NULL AS old_worker_rpc_kept;
