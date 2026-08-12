-- GPS/network/unified attendance must follow the same early-checkout approval
-- policy as record_staff_qr_attendance. Patch the latest function definition so
-- prior authentication-mode hardening remains intact.
DO $patch$
DECLARE
  fn regprocedure := to_regprocedure('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)');
  def text;
  patched text;
  old_checkout text := $old$UPDATE public.staff_attendances SET
          check_out_at=v_now,check_out_location=v_point,check_out_method=v_method,
          check_out_distance_m=v_distance,check_out_gps_accuracy_m=v_accuracy,
          check_out_status='SUCCESS',early_leave_minutes=v_early,status='completed',updated_at=v_now
        WHERE id=v_staff_att.id RETURNING id INTO v_attendance_id;$old$;
  new_checkout text := $new$IF v_early>0 THEN
          UPDATE public.staff_attendances SET
            checkout_requested_at=v_now,check_out_location=v_point,check_out_method=v_method,
            check_out_distance_m=v_distance,check_out_gps_accuracy_m=v_accuracy,
            check_out_status='SUCCESS',early_leave_minutes=v_early,status='checkout_pending',updated_at=v_now
          WHERE id=v_staff_att.id RETURNING id INTO v_attendance_id;
        ELSE
          UPDATE public.staff_attendances SET
            check_out_at=v_now,checkout_requested_at=v_now,check_out_location=v_point,check_out_method=v_method,
            check_out_distance_m=v_distance,check_out_gps_accuracy_m=v_accuracy,
            check_out_status='SUCCESS',early_leave_minutes=0,status='completed',updated_at=v_now
          WHERE id=v_staff_att.id RETURNING id INTO v_attendance_id;
        END IF;$new$;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%status=''checkout_pending''%' AND def LIKE '%''status'',CASE WHEN p_target_type=''staff''%' THEN
    RAISE NOTICE 'unified early checkout already patched';
    RETURN;
  END IF;
  patched := replace(def,old_checkout,new_checkout);
  IF patched=def THEN RAISE EXCEPTION 'staff checkout anchor not found'; END IF;
  patched := replace(patched,
    $old$'ok',true,'action',p_action,'method',v_method$old$,
    $new$'ok',true,'status',CASE WHEN p_target_type='staff' AND p_action='check_out' AND v_early>0 THEN 'pending' ELSE 'approved' END,'action',p_action,'method',v_method$new$);
  IF patched NOT LIKE '%''status'',CASE WHEN p_target_type=''staff''%' THEN
    RAISE EXCEPTION 'attendance response status anchor not found';
  END IF;
  patched := replace(patched,
    $old$'checkOutAt',CASE WHEN p_action='check_out' THEN v_now END$old$,
    $new$'checkOutAt',CASE WHEN p_action='check_out' AND NOT (p_target_type='staff' AND v_early>0) THEN v_now END$new$);
  EXECUTE patched;
END $patch$;

SELECT
  pg_get_functiondef(to_regprocedure('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'))
    LIKE '%status=''checkout_pending''%' AS early_checkout_pending_enabled;
