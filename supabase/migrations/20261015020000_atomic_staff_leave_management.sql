-- Administrator-created leave and annual balance edits must be atomic.
CREATE OR REPLACE FUNCTION public.create_approved_staff_leave(
  p_facility_id uuid,p_staff_id uuid,p_leave_type text,p_start_date date,p_end_date date,
  p_hourly_minutes integer DEFAULT NULL,p_reason text DEFAULT NULL
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
  INSERT INTO public.staff_leave_requests(facility_id,staff_id,leave_type,start_date,end_date,requested_minutes,reason,status,decided_by,decided_at)
  VALUES(p_facility_id,p_staff_id,p_leave_type,p_start_date,p_end_date,v_minutes,nullif(trim(p_reason),''),'approved',auth.uid(),now()) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_approved_staff_leave(uuid,uuid,text,date,date,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_approved_staff_leave(uuid,uuid,text,date,date,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_staff_leave_grant(
  p_facility_id uuid,p_staff_id uuid,p_year integer,p_granted_days numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_balance public.staff_leave_balances%ROWTYPE;v_minutes integer;
BEGIN
  IF auth.uid() IS NULL OR public.can_manage_facility(p_facility_id,ARRAY['owner','operator','super']) IS NOT TRUE THEN
    RAISE EXCEPTION '휴가 관리 권한이 없어요.';
  END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 2020 AND 2100 OR p_granted_days IS NULL OR p_granted_days<0 OR p_granted_days>365
    OR p_granted_days*480<>round(p_granted_days*480) THEN
    RAISE EXCEPTION '휴가 부여일수를 확인해 주세요.';
  END IF;
  PERFORM id FROM public.facility_staff WHERE id=p_staff_id AND facility_id=p_facility_id AND status<>'ended' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '직원을 찾지 못했어요.'; END IF;
  v_minutes := round(p_granted_days*480)::integer;
  SELECT * INTO v_balance FROM public.staff_leave_balances WHERE staff_id=p_staff_id AND leave_year=p_year FOR UPDATE;
  IF FOUND THEN
    IF v_minutes<v_balance.used_minutes THEN RAISE EXCEPTION '이미 사용한 휴가보다 총 부여시간을 작게 설정할 수 없어요.'; END IF;
    UPDATE public.staff_leave_balances SET granted_minutes=v_minutes,updated_at=now() WHERE id=v_balance.id;
  ELSE
    INSERT INTO public.staff_leave_balances(facility_id,staff_id,leave_year,granted_minutes,used_minutes,updated_at)
    VALUES(p_facility_id,p_staff_id,p_year,v_minutes,0,now());
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_staff_leave_grant(uuid,uuid,integer,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_staff_leave_grant(uuid,uuid,integer,numeric) TO authenticated;
