-- History correction + audit insertion are one transaction. Close/reopen and
-- correction share a facility/month lock; gig payouts share the staff lock.
CREATE OR REPLACE FUNCTION public.set_attendance_period_state(p_facility_id uuid,p_month date,p_action text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR public.can_manage_facility(p_facility_id,ARRAY['owner','operator','super']) IS NOT TRUE THEN
    RAISE EXCEPTION '근태 관리 권한이 없어요.';
  END IF;
  IF p_month IS NULL OR p_month<>date_trunc('month',p_month)::date OR p_action IS NULL OR p_action NOT IN ('close','reopen') OR length(trim(coalesce(p_reason,'')))<5 THEN
    RAISE EXCEPTION '마감 월과 사유를 확인해 주세요.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance-period:'||p_facility_id::text||':'||p_month::text,0));
  IF p_action='close' THEN
    IF p_month>=date_trunc('month',now() AT TIME ZONE 'Asia/Seoul')::date THEN
      RAISE EXCEPTION '이번 달 근태는 다음 달부터 마감할 수 있어요.';
    END IF;
    SELECT count(*) INTO v_count FROM public.staff_attendances
    WHERE facility_id=p_facility_id AND work_date>=p_month AND work_date<p_month+interval '1 month'
      AND (status IN ('working','checkout_pending') OR (check_in_at IS NOT NULL AND check_out_at IS NULL));
    IF v_count>0 THEN RAISE EXCEPTION '퇴근 누락·승인 대기 기록 %건을 먼저 정리해 주세요.',v_count; END IF;
  END IF;
  INSERT INTO public.attendance_period_closures(facility_id,period_month,status,reason,closed_by,closed_at,reopened_by,reopened_at,updated_at)
  VALUES(p_facility_id,p_month,CASE WHEN p_action='close' THEN 'closed' ELSE 'open' END,trim(p_reason),
    CASE WHEN p_action='close' THEN auth.uid() END,CASE WHEN p_action='close' THEN now() END,
    CASE WHEN p_action='reopen' THEN auth.uid() END,CASE WHEN p_action='reopen' THEN now() END,now())
  ON CONFLICT(facility_id,period_month) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,
    closed_by=CASE WHEN p_action='close' THEN EXCLUDED.closed_by ELSE public.attendance_period_closures.closed_by END,
    closed_at=CASE WHEN p_action='close' THEN EXCLUDED.closed_at ELSE public.attendance_period_closures.closed_at END,
    reopened_by=EXCLUDED.reopened_by,reopened_at=EXCLUDED.reopened_at,updated_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_staff_attendance(
  p_facility_id uuid,p_attendance_id uuid,p_month date,
  p_check_in timestamptz,p_check_out timestamptz,p_break_minutes integer,p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before public.staff_attendances%ROWTYPE;v_after public.staff_attendances%ROWTYPE;v_staff uuid;
BEGIN
  IF auth.uid() IS NULL OR public.can_manage_facility(p_facility_id,ARRAY['owner','operator','super']) IS NOT TRUE THEN
    RAISE EXCEPTION '근태 관리 권한이 없어요.';
  END IF;
  IF p_month IS NULL OR p_month<>date_trunc('month',p_month)::date OR length(trim(coalesce(p_reason,'')))<5
    OR p_check_in IS NULL OR p_check_out IS NULL OR NOT isfinite(p_check_in) OR NOT isfinite(p_check_out)
    OR p_check_out<=p_check_in OR p_check_out>clock_timestamp()
    OR p_break_minutes IS NULL OR p_break_minutes NOT BETWEEN 0 AND 480
    OR p_break_minutes*interval '1 minute'>p_check_out-p_check_in THEN
    RAISE EXCEPTION '수정 시간·휴게시간·사유를 확인해 주세요. 미래 시간은 기록할 수 없어요.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance-period:'||p_facility_id::text||':'||p_month::text,0));
  IF EXISTS(SELECT 1 FROM public.attendance_period_closures WHERE facility_id=p_facility_id AND period_month=p_month AND status='closed') THEN
    RAISE EXCEPTION '마감된 월은 먼저 재개방해야 수정할 수 있어요.';
  END IF;
  SELECT staff_id INTO v_staff FROM public.staff_attendances WHERE id=p_attendance_id AND facility_id=p_facility_id;
  IF v_staff IS NULL THEN RAISE EXCEPTION '수정할 근태 기록을 찾지 못했어요.'; END IF;
  PERFORM id FROM public.facility_staff WHERE id=v_staff AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '근무자 정보를 확인해 주세요.'; END IF;
  SELECT * INTO v_before FROM public.staff_attendances WHERE id=p_attendance_id AND facility_id=p_facility_id AND staff_id=v_staff FOR UPDATE;
  IF NOT FOUND OR v_before.work_date<p_month OR v_before.work_date>=p_month+interval '1 month' THEN
    RAISE EXCEPTION '수정할 근태 기록을 찾지 못했어요.';
  END IF;
  IF (p_check_in AT TIME ZONE 'Asia/Seoul')::date<>v_before.work_date THEN
    RAISE EXCEPTION '출근 날짜는 해당 근무일과 같아야 해요.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.gig_payouts p WHERE p.staff_id=v_staff AND p.status<>'cancelled' AND (
    (p.attendance_ids IS NOT NULL AND p_attendance_id=ANY(p.attendance_ids)) OR
    (p.attendance_ids IS NULL AND v_before.work_date BETWEEN p.period_start AND p.period_end
      AND v_before.check_out_at IS NOT NULL AND (p.covered_until IS NULL OR v_before.check_out_at<=p.covered_until))
  )) THEN RAISE EXCEPTION '지급에 포함된 근태는 수정할 수 없어요. 지급 예정은 먼저 취소하고, 지급 완료 건은 별도 정산 확인이 필요해요.'; END IF;
  IF EXISTS(SELECT 1 FROM public.staff_wage_payments WHERE staff_id=v_staff AND period_month=p_month AND status IN ('approved','exported','paid')) THEN
    RAISE EXCEPTION '확정된 월 급여가 있어요. 급여 처리 상태를 먼저 확인해 주세요.';
  END IF;
  UPDATE public.staff_attendances SET check_in_at=p_check_in,check_out_at=p_check_out,break_minutes=p_break_minutes,
    status='completed',corrected_by=auth.uid(),correction_reason=trim(p_reason),approved_by=auth.uid(),approved_at=now(),updated_at=now()
  WHERE id=p_attendance_id RETURNING * INTO v_after;
  INSERT INTO public.staff_attendance_change_logs(facility_id,attendance_id,changed_by,action,reason,before_data,after_data)
  VALUES(p_facility_id,p_attendance_id,auth.uid(),'correct',trim(p_reason),to_jsonb(v_before),to_jsonb(v_after));
END;
$$;
REVOKE ALL ON FUNCTION public.set_attendance_period_state(uuid,date,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.correct_staff_attendance(uuid,uuid,date,timestamptz,timestamptz,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_attendance_period_state(uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_staff_attendance(uuid,uuid,date,timestamptz,timestamptz,integer,text) TO authenticated;
