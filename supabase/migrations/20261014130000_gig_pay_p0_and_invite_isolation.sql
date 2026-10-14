-- 2026-10-14 단기근로 QA P0 (docs/QA_2026-10-14_단기근로.md)
-- 1) 지급 기간: 지급은 '마지막으로 포함한 퇴근 시각'(covered_until)까지로 닫는다. 날짜(period_end)로 닫으면
--    지급한 날 나중에 끝난 근무가 다음 계산에서 영영 빠졌다.
-- 2) 휴게 차감: 퇴근 기록이 완성될 때 facility_staff.default_break_minutes 를 staff_attendances.break_minutes 에 적는다.
--    (4시간 미만은 0, 명시한 값이 있으면 존중). 지금까지는 늘 0이라 휴게가 한 번도 차감되지 않았다.
-- 3) 시연 격리(역방향): 시연 사업장 초대는 시연 계정만 수락·미리보기 가능. 고정 토큰이 URL에 노출돼 있어
--    실제 가입자가 수락하면 계좌가 공용 시연 사장님 화면에 떴다.

-- ── 1. gig_payouts.covered_until ─────────────────────────────────────────────
ALTER TABLE public.gig_payouts ADD COLUMN IF NOT EXISTS covered_until timestamptz;
COMMENT ON COLUMN public.gig_payouts.covered_until IS '이 지급에 포함된 마지막 퇴근 시각. 다음 지급은 이 시각 이후 완료된 근무부터 센다(같은 날 두 번째 근무 누락 방지).';
-- 같은 날짜 두 번 지급을 막던 유니크는 같은 covered_until 중복(이중 제출)만 막는 것으로 바꾼다
DROP INDEX IF EXISTS public.uq_gig_payouts_active_staff_period;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gig_payouts_active_staff_covered
  ON public.gig_payouts(staff_id, covered_until)
  WHERE status <> 'cancelled' AND covered_until IS NOT NULL;
COMMENT ON INDEX public.uq_gig_payouts_active_staff_covered IS '동일 근무자·동일 포함 범위(covered_until)의 지급 중복 생성 방지(이중 제출). cancelled 는 재생성 허용.';

-- ── 2. 퇴근 완성 시 휴게 자동 기입 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_staff_attendance_break()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default integer;
  v_worked integer;
BEGIN
  IF NEW.check_in_at IS NULL OR NEW.check_out_at IS NULL THEN RETURN NEW; END IF;
  -- 이미 퇴근 처리된 행의 뒤늦은 수정(관리자 정정)은 건드리지 않는다 — 명시값 존중
  IF TG_OP = 'UPDATE' AND OLD.check_out_at IS NOT NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.break_minutes, 0) > 0 THEN RETURN NEW; END IF;
  v_worked := GREATEST(0, floor(extract(epoch FROM (NEW.check_out_at - NEW.check_in_at)) / 60))::integer;
  IF v_worked < 240 THEN RETURN NEW; END IF; -- 4시간 미만은 법정 휴게 없음
  SELECT default_break_minutes INTO v_default FROM public.facility_staff WHERE id = NEW.staff_id;
  NEW.break_minutes := LEAST(COALESCE(v_default, 0), v_worked);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fill_staff_attendance_break() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_staff_attendance_fill_break ON public.staff_attendances;
CREATE TRIGGER trg_staff_attendance_fill_break
  BEFORE INSERT OR UPDATE OF check_out_at, break_minutes ON public.staff_attendances
  FOR EACH ROW EXECUTE FUNCTION public.fill_staff_attendance_break();

-- ── 3. 시연 사업장 초대는 시연 계정만 (미리보기·수락) ─────────────────────────
DO $patch$
DECLARE r record; v_def text; v_new text; v_hit boolean;
BEGIN
  -- 미리보기: jsonb 반환이라 ok:false 로 안내
  v_hit := false;
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_facility_staff_invite_preview' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%DEMO_ONLY%' THEN v_hit := true; CONTINUE; END IF;
    v_new := replace(v_def,
      E'RETURN jsonb_build_object(''ok'',false,''reason'',''INVALID'',''message'',''연결할 근무 정보를 찾지 못했어요.'');\n  END IF;',
      E'RETURN jsonb_build_object(''ok'',false,''reason'',''INVALID'',''message'',''연결할 근무 정보를 찾지 못했어요.'');\n  END IF;\n  IF v_facility.is_demo AND NOT public.is_demo_account(auth.uid()) THEN\n    RETURN jsonb_build_object(''ok'',false,''reason'',''DEMO_ONLY'',''message'',''시연용 초대 링크예요. 시연은 시작 화면의 ‘써보기’로 열어 주세요.'');\n  END IF;');
    IF v_new <> v_def THEN EXECUTE v_new; v_hit := true; END IF;
  END LOOP;
  IF NOT v_hit THEN RAISE EXCEPTION 'invite_isolation: get_facility_staff_invite_preview source drifted'; END IF;

  -- 수락: 예외
  v_hit := false;
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'claim_facility_staff_invite' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%시연용 초대 링크예요%' THEN v_hit := true; CONTINUE; END IF;
    v_new := replace(v_def,
      E'시연을 끝내고 내 계정으로 받아 주세요.''; END IF;',
      E'시연을 끝내고 내 계정으로 받아 주세요.''; END IF;\n\n  IF EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = v_invite.facility_id AND f.is_demo)\n     AND NOT public.is_demo_account(auth.uid()) THEN\n    RAISE EXCEPTION ''시연용 초대 링크예요. 시연은 시작 화면의 ‘써보기’로 열어 주세요.'';\n  END IF;');
    IF v_new <> v_def THEN EXECUTE v_new; v_hit := true; END IF;
  END LOOP;
  IF NOT v_hit THEN RAISE EXCEPTION 'invite_isolation: claim_facility_staff_invite source drifted (demo_account anchor not found)'; END IF;
END
$patch$;
