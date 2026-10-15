-- Read only: no authentication attempts or attendance writes. Never accepts a caller-supplied facility.
CREATE FUNCTION public.get_my_attendance_policy(p_target_type text,p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_facility uuid; v_setting public.facility_attendance_settings%ROWTYPE; v_worker uuid;
BEGIN
  v_worker:=public.current_worker_id();
  IF v_worker IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF p_target_type='staff' THEN
    SELECT facility_id INTO v_facility FROM public.facility_staff WHERE id=p_target_id AND worker_id=v_worker AND status='active';
  ELSIF p_target_type='shift' THEN
    SELECT s.facility_id INTO v_facility FROM public.shift_applications a JOIN public.shifts s ON s.id=a.shift_id
      WHERE a.id=p_target_id AND a.worker_id=v_worker AND a.status IN ('accepted','completed');
  END IF;
  IF v_facility IS NULL THEN RAISE EXCEPTION '연결된 근무의 인증 규칙만 확인할 수 있어요'; END IF;
  SELECT * INTO v_setting FROM public.facility_attendance_settings WHERE facility_id=v_facility;
  RETURN jsonb_build_object('mode',coalesce(v_setting.authentication_mode,'gps'),'qrFallback',coalesce(v_setting.qr_fallback_enabled,true),'facilityId',v_facility);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_attendance_policy(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_attendance_policy(text,uuid) TO authenticated;
