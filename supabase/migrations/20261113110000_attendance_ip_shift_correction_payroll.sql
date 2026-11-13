-- 출퇴근 점검 P0 3건 (2026-11-13, docs/QA_2026-11-13_출퇴근흐름_점검.md #3·#1·#2, 결정 D6~D8)
--
-- ③ 사업장 네트워크 인증의 IP (D6)
--    X-Forwarded-For 의 맨 앞 값은 근무자가 직접 보낸 값이 그대로 남는다(앞단은 실제 IP를 뒤에 덧붙임).
--    집에서 `X-Forwarded-For: <병원 IP>` 를 붙이면 Wi-Fi 인증과 GPS 모드의 네트워크 보조 경로가 통과됐다.
--    Cloudflare 가 넣는 cf-connecting-ip(클라이언트가 못 바꿈)를 먼저 쓰고, 없으면 X-Forwarded-For 의 맨 뒤 값을 쓴다.
--    attendance_client_ip() 는 호출한 사람 자신의 IP만 돌려주므로 확인용으로 열어 둔다.
--
-- ① 공고 근무 근태 정정 (D7)
--    관리자 퇴근 처리는 퇴근 시각을 '지금'으로 찍어 그만큼 임금이 늘었고, 36시간이 지나면 임금 계산이 예외로 막혀
--    영영 닫을 수 없었다. 근태 기록 화면도 직원만 고칠 수 있었다. correct_shift_attendance(시각+사유) 로
--    출퇴근 시각을 바로잡고 지각·조퇴 분과 임금(wage_calculations)·지급 지시를 다시 계산한다. 승인·지급된 건과 마감된 달은 막는다.
--
-- ② 계좌 없을 때 공고 근무 지급 지시 누락 (D8)
--    퇴근 순간 주 계좌가 없으면 지급 지시를 아예 만들지 않았고, 나중에 계좌를 넣어도 다시 만들지 않아 급여 화면에 안 나왔다.
--    이제 계좌 없이도 지급 지시를 만들고(승인 단계가 이미 '은행·계좌 끝 4자리 먼저 확인' 으로 막음),
--    근무자가 주 계좌를 등록하면 아직 승인 전인 지시에 계좌를 채운다. 최근 90일 누락분은 이번에 채운다.

-- ---------------------------------------------------------------------------
-- ③ 요청한 사람의 실제 IP
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_client_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_headers json;
  v_ip text;
  v_parts text[];
BEGIN
  v_headers := NULLIF(current_setting('request.headers', true), '')::json;
  IF v_headers IS NULL THEN RETURN NULL; END IF;
  -- Cloudflare 가 연결한 클라이언트 주소로 덮어쓰는 헤더 — 요청에 같은 이름을 넣어도 바뀐다
  v_ip := NULLIF(trim(v_headers->>'cf-connecting-ip'), '');
  IF v_ip IS NULL THEN
    -- 앞단 프록시는 실제 주소를 '뒤에' 덧붙인다. 맨 앞은 클라이언트가 보낸 값일 수 있으므로 맨 뒤를 쓴다.
    v_parts := string_to_array(COALESCE(v_headers->>'x-forwarded-for', ''), ',');
    IF COALESCE(array_length(v_parts, 1), 0) > 0 THEN
      v_ip := NULLIF(trim(v_parts[array_length(v_parts, 1)]), '');
    END IF;
  END IF;
  RETURN left(v_ip, 45);
END;
$function$;
REVOKE ALL ON FUNCTION public.attendance_client_ip() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attendance_client_ip() TO anon, authenticated, service_role;

DO $ip_patch$
DECLARE
  fn regprocedure := to_regprocedure(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'
  );
  def text;
  patched text;
  needle text := $needle$  v_ip := NULLIF(trim(split_part(COALESCE(
    (current_setting('request.headers', true))::json->>'x-forwarded-for',
    (current_setting('request.headers', true))::json->>'x-real-ip',
    ''), ',', 1)), '');$needle$;
  replacement text := $replacement$  -- 요청한 사람의 실제 IP — X-Forwarded-For 맨 앞 값은 꾸밀 수 있다 (docs/attendance/DECISIONS.md D6)
  v_ip := public.attendance_client_ip();$replacement$;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  def := pg_get_functiondef(fn);
  IF position('public.attendance_client_ip()' in def) > 0 THEN RETURN; END IF;
  IF (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 THEN
    RAISE EXCEPTION '네트워크 IP 판정 위치를 하나로 찾지 못했습니다 — record_unified_attendance 본문이 예상과 다릅니다';
  END IF;
  patched := replace(def, needle, replacement);
  EXECUTE patched;
END;
$ip_patch$;

-- ---------------------------------------------------------------------------
-- ①② 공고 근무 임금·지급 지시 다시 계산 (퇴근 트리거와 근태 정정이 같이 쓴다)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_shift_wage(p_attendance_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_att public.shift_attendances%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_wage jsonb;
  v_gross integer;
  v_wage_id uuid;
  v_bank public.worker_bank_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_att FROM public.shift_attendances WHERE id = p_attendance_id;
  IF NOT FOUND OR v_att.check_in_at IS NULL OR v_att.check_out_at IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id = v_att.shift_id;
  SELECT * INTO v_facility FROM public.facilities WHERE id = v_shift.facility_id;
  v_wage := public.calculate_shift_wage_secure(
    v_att.check_in_at, v_att.check_out_at, v_shift.hourly_wage,
    COALESCE(v_facility.is_5plus, false), v_shift.is_holiday
  );
  v_gross := (v_wage->>'gross')::integer;
  INSERT INTO public.wage_calculations(
    attendance_id, org_id, worker_id, shift_id, rule_version, worked_minutes,
    night_minutes, overtime_minutes, break_minutes, base, overtime_premium,
    night_premium, holiday_premium, gross, breakdown, calculated_at
  ) VALUES (
    v_att.id, v_shift.facility_id, v_att.worker_id, v_shift.id, v_wage->>'ruleVersion',
    (v_wage->>'workedMinutes')::integer, (v_wage->>'nightMinutes')::integer,
    (v_wage->>'overtimeMinutes')::integer, (v_wage->>'breakMinutes')::integer,
    (v_wage->>'base')::integer, (v_wage->>'overtimePremium')::integer,
    (v_wage->>'nightPremium')::integer, (v_wage->>'holidayPremium')::integer,
    v_gross, v_wage, now()
  ) ON CONFLICT (attendance_id) DO UPDATE SET
    rule_version = EXCLUDED.rule_version,
    worked_minutes = EXCLUDED.worked_minutes, night_minutes = EXCLUDED.night_minutes,
    overtime_minutes = EXCLUDED.overtime_minutes, break_minutes = EXCLUDED.break_minutes,
    base = EXCLUDED.base, overtime_premium = EXCLUDED.overtime_premium,
    night_premium = EXCLUDED.night_premium, holiday_premium = EXCLUDED.holiday_premium,
    gross = EXCLUDED.gross, breakdown = EXCLUDED.breakdown, calculated_at = EXCLUDED.calculated_at
  RETURNING id INTO v_wage_id;

  -- 주 계좌가 없어도 지급 지시는 만든다(D8). 승인 단계가 은행·계좌 끝 4자리를 요구하므로 잘못 나가지 않는다.
  SELECT * INTO v_bank FROM public.worker_bank_accounts
   WHERE worker_id = v_att.worker_id AND is_primary = true AND deleted_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  INSERT INTO public.wage_payment_instructions(
    facility_id, worker_id, shift_id, attendance_id, wage_calculation_id,
    bank_account_id, gross_amount, deduction_status, net_amount, due_date,
    bank_name_snapshot, account_last4_snapshot
  ) VALUES (
    v_shift.facility_id, v_att.worker_id, v_shift.id, v_att.id, v_wage_id,
    v_bank.id, v_gross, 'unconfirmed', v_gross, v_shift.shift_date + 7,
    v_bank.bank_name, v_bank.account_number_last4
  ) ON CONFLICT (attendance_id) DO UPDATE SET
    wage_calculation_id = EXCLUDED.wage_calculation_id,
    gross_amount = EXCLUDED.gross_amount,
    -- 금액이 바뀌면 이전에 확인한 공제는 맞지 않으므로 다시 확인하게 한다
    deduction_status = CASE WHEN public.wage_payment_instructions.gross_amount = EXCLUDED.gross_amount
      THEN public.wage_payment_instructions.deduction_status ELSE 'unconfirmed' END,
    income_tax_amount = CASE WHEN public.wage_payment_instructions.gross_amount = EXCLUDED.gross_amount
      THEN public.wage_payment_instructions.income_tax_amount ELSE 0 END,
    local_tax_amount = CASE WHEN public.wage_payment_instructions.gross_amount = EXCLUDED.gross_amount
      THEN public.wage_payment_instructions.local_tax_amount ELSE 0 END,
    other_deduction_amount = CASE WHEN public.wage_payment_instructions.gross_amount = EXCLUDED.gross_amount
      THEN public.wage_payment_instructions.other_deduction_amount ELSE 0 END,
    net_amount = CASE WHEN public.wage_payment_instructions.gross_amount = EXCLUDED.gross_amount
      THEN public.wage_payment_instructions.net_amount ELSE EXCLUDED.gross_amount END,
    bank_account_id = COALESCE(public.wage_payment_instructions.bank_account_id, EXCLUDED.bank_account_id),
    bank_name_snapshot = COALESCE(public.wage_payment_instructions.bank_name_snapshot, EXCLUDED.bank_name_snapshot),
    account_last4_snapshot = COALESCE(public.wage_payment_instructions.account_last4_snapshot, EXCLUDED.account_last4_snapshot),
    updated_at = now()
  -- 승인·내보내기·지급이 끝난 지시는 건드리지 않는다
  WHERE public.wage_payment_instructions.status IN ('draft', 'disputed');
  RETURN v_gross;
END;
$function$;
REVOKE ALL ON FUNCTION public.recompute_shift_wage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_shift_wage(uuid) TO service_role;

-- 첫 퇴근 때만 계산하는 규칙은 그대로, 계산은 공용 함수로
CREATE OR REPLACE FUNCTION public.sync_shift_checkout_to_payroll()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.check_out_at IS NOT NULL OR NEW.check_out_at IS NULL OR NEW.check_in_at IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM public.recompute_shift_wage(NEW.id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_shift_checkout_to_payroll() FROM PUBLIC, anon, authenticated;

-- ② 근무자가 주 계좌를 등록·변경하면 아직 승인 전이고 계좌가 빈 지급 지시에 채운다
CREATE OR REPLACE FUNCTION public.fill_wage_instruction_bank()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.is_primary IS TRUE AND NEW.deleted_at IS NULL THEN
    UPDATE public.wage_payment_instructions
       SET bank_account_id = NEW.id, bank_name_snapshot = NEW.bank_name,
           account_last4_snapshot = NEW.account_number_last4, updated_at = now()
     WHERE worker_id = NEW.worker_id AND bank_account_id IS NULL AND status IN ('draft', 'disputed');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fill_wage_instruction_bank() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_fill_wage_instruction_bank ON public.worker_bank_accounts;
CREATE TRIGGER trg_fill_wage_instruction_bank
  AFTER INSERT OR UPDATE OF is_primary, deleted_at ON public.worker_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fill_wage_instruction_bank();

-- ② 최근 90일 동안 계좌가 없어 빠진 지급 지시를 채운다(시연 사업장 제외, 계산 실패 건은 건너뜀)
DO $backfill$
DECLARE
  r record;
  v_done integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR r IN
    SELECT a.id FROM public.shift_attendances a
      JOIN public.shifts s ON s.id = a.shift_id
      JOIN public.facilities f ON f.id = s.facility_id
     WHERE a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
       AND a.check_out_at >= now() - interval '90 days'
       AND COALESCE(f.is_demo, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.wage_payment_instructions w WHERE w.attendance_id = a.id)
  LOOP
    BEGIN
      PERFORM public.recompute_shift_wage(r.id);
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;
  RAISE NOTICE '빠진 공고 근무 지급 지시 % 건 생성, % 건 건너뜀', v_done, v_skipped;
END;
$backfill$;

-- ---------------------------------------------------------------------------
-- ① 공고 근무 근태 정정 — 시각 + 사유, 임금 다시 계산, 감사 기록(위치 좌표는 남기지 않음)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_shift_attendance(
  p_attendance_id uuid,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_before public.shift_attendances%ROWTYPE;
  v_after public.shift_attendances%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_pay_status text;
  v_month date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_grace integer;
  v_early_grace integer;
  v_late integer;
  v_early integer;
  v_gross_before integer;
  v_gross integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '근태 관리 권한이 없어요.'; END IF;
  SELECT * INTO v_before FROM public.shift_attendances WHERE id = p_attendance_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '수정할 근무 기록을 찾지 못했어요.'; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id = v_before.shift_id;
  IF public.can_manage_facility(v_shift.facility_id, ARRAY['owner','operator','super']) IS NOT TRUE THEN
    RAISE EXCEPTION '근태 관리 권한이 없어요.';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 5
     OR p_check_in IS NULL OR p_check_out IS NULL OR NOT isfinite(p_check_in) OR NOT isfinite(p_check_out)
     OR p_check_out <= p_check_in OR p_check_out > clock_timestamp() THEN
    RAISE EXCEPTION '출퇴근 시간과 사유(5자 이상)를 확인해 주세요. 퇴근은 출근보다 늦고 지금보다 이르게요.';
  END IF;
  IF p_check_out - p_check_in > interval '24 hours' THEN
    RAISE EXCEPTION '한 번의 근무는 24시간을 넘길 수 없어요.';
  END IF;
  IF (p_check_in AT TIME ZONE 'Asia/Seoul')::date NOT IN (v_shift.shift_date, v_shift.shift_date - 1) THEN
    RAISE EXCEPTION '출근 날짜는 근무일(또는 전날 밤)이어야 해요.';
  END IF;

  v_month := date_trunc('month', v_shift.shift_date)::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance-period:'||v_shift.facility_id::text||':'||v_month::text, 0));
  IF EXISTS (SELECT 1 FROM public.attendance_period_closures
              WHERE facility_id = v_shift.facility_id AND period_month = v_month AND status = 'closed') THEN
    RAISE EXCEPTION '마감된 월은 먼저 재개방해야 수정할 수 있어요.';
  END IF;
  SELECT status, gross_amount INTO v_pay_status, v_gross_before
    FROM public.wage_payment_instructions WHERE attendance_id = p_attendance_id FOR UPDATE;
  IF v_pay_status IN ('approved', 'exported', 'paid', 'worker_confirmed') THEN
    RAISE EXCEPTION '이미 승인·지급된 근무는 수정할 수 없어요. 급여 화면에서 지급 상태를 먼저 확인해 주세요.';
  END IF;

  -- 지각·조퇴 분도 고친 시각으로 다시 센다(출퇴근 RPC 와 같은 유예 규칙)
  SELECT GREATEST(0, COALESCE(s.late_grace_minutes, 20)), GREATEST(0, COALESCE(s.early_leave_grace_minutes, 10))
    INTO v_grace, v_early_grace
    FROM public.facility_attendance_settings s WHERE s.facility_id = v_shift.facility_id;
  v_grace := COALESCE(v_grace, 20); v_early_grace := COALESCE(v_early_grace, 10);
  v_start_at := (v_shift.shift_date + v_shift.start_time) AT TIME ZONE 'Asia/Seoul';
  v_end_at := (v_shift.shift_date + v_shift.end_time
               + CASE WHEN v_shift.is_overnight THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Asia/Seoul';
  v_late := GREATEST(0, floor(extract(epoch FROM (p_check_in - v_start_at)) / 60)::integer - v_grace);
  v_early := GREATEST(0, floor(extract(epoch FROM (v_end_at - p_check_out)) / 60)::integer - v_early_grace);

  UPDATE public.shift_attendances SET
    check_in_at = p_check_in,
    check_out_at = p_check_out,
    check_in_method = COALESCE(check_in_method, 'ADMIN'),
    check_in_status = COALESCE(check_in_status, 'SUCCESS'),
    check_out_method = CASE WHEN v_before.check_out_at IS NULL THEN 'ADMIN' ELSE check_out_method END,
    check_out_status = COALESCE(check_out_status, 'SUCCESS'),
    late_minutes = v_late,
    early_leave_minutes = v_early,
    manual_override_by = auth.uid(),
    manual_override_reason = trim(p_reason),
    approved_at = now(),
    updated_at = now()
  WHERE id = p_attendance_id
  RETURNING * INTO v_after;
  UPDATE public.shift_applications SET checked_in_at = p_check_in, checked_out_at = p_check_out, status = 'completed'
   WHERE id = v_before.application_id;
  UPDATE public.shifts SET status = 'completed', updated_at = now() WHERE id = v_shift.id;
  -- 처음 퇴근이 들어가면 트리거가 이미 계산했고, 시각만 바꾼 경우는 여기서 다시 계산한다(같은 결과면 그대로)
  v_gross := public.recompute_shift_wage(p_attendance_id);

  INSERT INTO public.audit_logs(actor_type, actor_id, action, entity_type, entity_id, before_data, after_data)
  VALUES ('facility', auth.uid(), 'attendance.shift_correct', 'shift_attendance', p_attendance_id,
    jsonb_build_object('check_in_at', v_before.check_in_at, 'check_out_at', v_before.check_out_at,
      'late_minutes', v_before.late_minutes, 'early_leave_minutes', v_before.early_leave_minutes,
      'missing_checkout_at', v_before.missing_checkout_at, 'gross', v_gross_before),
    jsonb_build_object('check_in_at', v_after.check_in_at, 'check_out_at', v_after.check_out_at,
      'late_minutes', v_after.late_minutes, 'early_leave_minutes', v_after.early_leave_minutes,
      'gross', v_gross, 'reason', trim(p_reason)));
  RETURN jsonb_build_object('ok', true, 'attendanceId', p_attendance_id, 'gross', v_gross,
    'lateMinutes', v_late, 'earlyLeaveMinutes', v_early);
END;
$function$;
REVOKE ALL ON FUNCTION public.correct_shift_attendance(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_shift_attendance(uuid, timestamptz, timestamptz, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 확인
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  def text := pg_get_functiondef(to_regprocedure(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'));
BEGIN
  IF position('public.attendance_client_ip()' in def) = 0 THEN RAISE EXCEPTION '네트워크 IP 패치 실패'; END IF;
  IF position('x-forwarded-for' in def) > 0 THEN RAISE EXCEPTION '출퇴근 함수에 X-Forwarded-For 맨 앞 값 판정이 남아 있음'; END IF;
  IF position('recompute_shift_wage' in pg_get_functiondef('public.sync_shift_checkout_to_payroll()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '퇴근 트리거가 공용 임금 계산을 쓰지 않음';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_fill_wage_instruction_bank') <> 1 THEN
    RAISE EXCEPTION '계좌 채우기 트리거 없음';
  END IF;
  RAISE NOTICE 'IP 판정·공고 근무 정정·지급 지시 보강 적용 완료';
END
$verify$;
