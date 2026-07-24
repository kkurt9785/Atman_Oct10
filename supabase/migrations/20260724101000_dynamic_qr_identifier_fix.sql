-- PL/pgSQL output column names are variables; qualify challenge columns.
CREATE OR REPLACE FUNCTION public.issue_facility_attendance_qr(p_facility_id uuid)
RETURNS TABLE(token text, issued_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_issued timestamptz := clock_timestamp();
  v_expires timestamptz := v_issued + interval '60 seconds';
BEGIN
  IF NOT public.can_manage_facility(p_facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '동적 QR을 표시할 권한이 없어요';
  END IF;
  UPDATE public.facility_attendance_qr_challenges AS challenge
  SET revoked_at = v_issued
  WHERE challenge.facility_id = p_facility_id
    AND challenge.revoked_at IS NULL
    AND challenge.expires_at > v_issued;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.facility_attendance_qr_challenges(
    facility_id,token_hash,issued_at,expires_at,issued_by
  ) VALUES (
    p_facility_id,encode(extensions.digest(v_token,'sha256'),'hex'),
    v_issued,v_expires,auth.uid()
  );
  RETURN QUERY SELECT v_token,v_issued,v_expires;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_facility_attendance_qr(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_facility_attendance_qr(uuid) TO authenticated;
