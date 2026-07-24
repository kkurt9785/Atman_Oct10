-- Hospital indoor GPS can drift. Prefer one-tap GPS, then a short-lived
-- hospital QR only when location verification is unavailable.
ALTER TABLE public.facility_attendance_settings
  ALTER COLUMN authentication_mode SET DEFAULT 'gps_or_qr';

UPDATE public.facility_attendance_settings
SET authentication_mode='gps_or_qr',updated_at=now()
WHERE authentication_mode='gps'
  AND gps_radius_meters=30
  AND max_gps_accuracy_meters=80
  AND qr_fallback_enabled=true
  AND check_in_before_minutes=60
  AND check_in_after_minutes=60
  AND check_out_before_minutes=60
  AND check_out_after_minutes=120;
