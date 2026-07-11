-- ============================================================================
-- P0 production hardening (4/4): release gate
--   * remove legacy direct-write privileges/policies
--   * disable legacy financial mutators that bypass provider/payment ledgers
--   * provide one-time, service-role-only facility invite rotation
-- ============================================================================

-- Sensitive/financial tables are append-only or RPC-only for application users.
REVOKE INSERT, UPDATE, DELETE ON public.memberships FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.entitlements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.credit_ledger FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.worker_credit_ledger FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.credit_payout_requests FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_audit FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.notification_outbox FROM anon, authenticated;

-- Replace old FOR ALL policies with read-only, facility-scoped policies.
DROP POLICY IF EXISTS org_admin_memberships ON public.memberships;
CREATE POLICY memberships_select_facility ON public.memberships
  FOR SELECT USING (public.facility_access_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS org_admin_subscriptions ON public.subscriptions;
CREATE POLICY subscriptions_select_facility ON public.subscriptions
  FOR SELECT USING (public.facility_access_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS org_admin_entitlements ON public.entitlements;
CREATE POLICY entitlements_select_facility ON public.entitlements
  FOR SELECT USING (public.facility_access_role(org_id) IS NOT NULL);

-- Keep worker-facing financial tables read-only; all mutations go through the
-- transaction-safe RPCs in 20260710232000_p0_payment_credit_push.sql.
DROP POLICY IF EXISTS wcl_own_select ON public.worker_credit_ledger;
CREATE POLICY worker_credit_ledger_select_own ON public.worker_credit_ledger
  FOR SELECT USING (worker_id = public.current_worker_id());

DROP POLICY IF EXISTS cpr_own_select ON public.credit_payout_requests;
CREATE POLICY credit_payout_requests_select_own ON public.credit_payout_requests
  FOR SELECT USING (worker_id = public.current_worker_id());

-- Disable prototype membership functions. They create value without a verified
-- provider order and must not remain callable by browser roles.
REVOKE ALL ON FUNCTION public.grant_membership_entitlements(uuid,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_membership(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_membership_cycle(uuid,integer)
  FROM PUBLIC, anon, authenticated;

-- Explicitly limit sensitive service functions even if a database default
-- privilege granted EXECUTE to PUBLIC in the past.
REVOKE ALL ON FUNCTION public.process_credit_payout(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_outbox(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_notification_outbox(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_credit_payment(text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_payment_reconciliation(text,text,jsonb,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_credit_payout(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_outbox(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_credit_payment(text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_reconciliation(text,text,jsonb,text,text) TO service_role;

-- Rotate an invite code from a trusted operator process. The plaintext is
-- returned once and never stored; only its bcrypt hash remains in facilities.
CREATE OR REPLACE FUNCTION public.rotate_facility_invite_code(
  p_facility_id uuid,
  p_valid_for interval DEFAULT interval '7 days'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF p_valid_for <= interval '5 minutes' OR p_valid_for > interval '90 days' THEN
    RAISE EXCEPTION 'invalid invite validity';
  END IF;

  v_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
  UPDATE public.facilities
  SET invite_code = NULL,
      invite_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf')),
      invite_code_expires_at = now() + p_valid_for,
      invite_code_used_at = NULL,
      invite_failed_attempts = 0,
      invite_locked_until = NULL,
      updated_at = now()
  WHERE id = p_facility_id
    AND is_active = true
    AND deleted_at IS NULL;

  IF NOT FOUND THEN RAISE EXCEPTION 'facility not found'; END IF;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_facility_invite_code(uuid,interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_facility_invite_code(uuid,interval)
  TO service_role;
