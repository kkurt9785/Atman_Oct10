-- Apply the same 90-day raw-coordinate policy to successful attendance rows.
CREATE OR REPLACE FUNCTION public.apply_attendance_location_retention()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.attendance_auth_logs
  SET latitude=NULL,longitude=NULL
  WHERE created_at<now()-interval '90 days'
    AND (latitude IS NOT NULL OR longitude IS NOT NULL);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.staff_attendances
  SET check_in_location=NULL,check_out_location=NULL
  WHERE work_date<current_date-90
    AND (check_in_location IS NOT NULL OR check_out_location IS NOT NULL);
  UPDATE public.shift_attendances AS attendance
  SET check_in_location=NULL,check_out_location=NULL
  FROM public.shifts AS shift
  WHERE shift.id=attendance.shift_id
    AND shift.shift_date<current_date-90
    AND (attendance.check_in_location IS NOT NULL OR attendance.check_out_location IS NOT NULL);
  DELETE FROM public.attendance_auth_logs
  WHERE created_at<now()-interval '3 years';
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_attendance_location_retention() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_attendance_location_retention() TO service_role;
