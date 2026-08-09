-- Make all three headline demo accounts deterministic for filming.
UPDATE public.facilities SET plan_code='clinic', updated_at=now()
WHERE business_registration_number IN ('DEMO-TARGET-0001','DEMO-TARGET-0026')
  AND is_demo=true;

UPDATE public.facilities SET plan_code='pharmacy', updated_at=now()
WHERE business_registration_number='DEMO-TARGET-PHARMACY' AND is_demo=true;

INSERT INTO public.facility_attendance_settings (
  facility_id, authentication_mode, gps_radius_meters,
  max_gps_accuracy_meters, qr_fallback_enabled,
  check_in_before_minutes, check_in_after_minutes,
  check_out_before_minutes, check_out_after_minutes
)
SELECT id, 'gps_or_qr', 30, 80, true, 60, 60, 60, 120
FROM public.facilities
WHERE business_registration_number IN (
  'DEMO-TARGET-0001','DEMO-TARGET-PHARMACY','DEMO-TARGET-0026'
) AND is_demo=true AND is_active=true AND deleted_at IS NULL
ON CONFLICT (facility_id) DO UPDATE SET
  authentication_mode='gps_or_qr', gps_radius_meters=30,
  max_gps_accuracy_meters=80, qr_fallback_enabled=true,
  updated_at=now();
