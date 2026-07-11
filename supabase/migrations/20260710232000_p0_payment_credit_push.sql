-- ============================================================================
-- P0 production hardening (3/3)
--   * server-created payment order ledger and provider reconciliation
--   * idempotent credit issuance
--   * race-safe worker credit payout reservation
--   * durable push outbox helpers
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE CHECK (length(order_id) BETWEEN 6 AND 64),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tier_id integer NOT NULL,
  order_name text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  base_credit integer NOT NULL CHECK (base_credit >= 0),
  bonus_credit integer NOT NULL DEFAULT 0 CHECK (bonus_credit >= 0),
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready','confirming','paid','failed','cancelled','partial_cancelled','reconcile_required')),
  provider text NOT NULL DEFAULT 'toss',
  provider_payment_key text UNIQUE,
  provider_status text,
  provider_payload jsonb,
  failure_code text,
  failure_message text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_facility_created
  ON public.payment_orders(facility_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_reconcile
  ON public.payment_orders(status, updated_at)
  WHERE status IN ('confirming','reconcile_required');
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_orders_select_facility ON public.payment_orders;
CREATE POLICY payment_orders_select_facility ON public.payment_orders
  FOR SELECT USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.payment_orders FROM anon, authenticated;
GRANT SELECT ON public.payment_orders TO authenticated;

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS payment_order_id uuid REFERENCES public.payment_orders(id),
  ADD COLUMN IF NOT EXISTS refundable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_bucket text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_idempotency
  ON public.credit_ledger(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP POLICY IF EXISTS org_admin_credit ON public.credit_ledger;
DROP POLICY IF EXISTS credit_ledger_select_facility ON public.credit_ledger;
CREATE POLICY credit_ledger_select_facility ON public.credit_ledger
  FOR SELECT USING (public.facility_access_role(org_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.credit_ledger FROM anon, authenticated;
GRANT SELECT ON public.credit_ledger TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_credit_payment(
  p_order_id text,
  p_payment_key text,
  p_provider_status text,
  p_provider_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_expires_at timestamptz := now() + interval '1 year';
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment order not found'; END IF;

  IF v_order.status = 'paid' THEN
    IF v_order.provider_payment_key IS DISTINCT FROM p_payment_key THEN
      RAISE EXCEPTION 'payment key mismatch';
    END IF;
    RETURN jsonb_build_object(
      'orderId', v_order.order_id,
      'credited', v_order.base_credit + v_order.bonus_credit,
      'alreadyProcessed', true
    );
  END IF;

  IF upper(COALESCE(p_provider_status, '')) <> 'DONE' THEN
    RAISE EXCEPTION 'provider payment is not DONE';
  END IF;
  IF p_provider_payload->>'orderId' IS DISTINCT FROM v_order.order_id THEN
    RAISE EXCEPTION 'provider order id mismatch';
  END IF;
  IF (p_provider_payload->>'paymentKey') IS DISTINCT FROM p_payment_key THEN
    RAISE EXCEPTION 'provider payment key mismatch';
  END IF;
  IF COALESCE((p_provider_payload->>'totalAmount')::integer, -1) <> v_order.amount THEN
    RAISE EXCEPTION 'provider amount mismatch';
  END IF;

  UPDATE public.payment_orders
  SET status = 'paid',
      provider_payment_key = p_payment_key,
      provider_status = p_provider_status,
      provider_payload = p_provider_payload,
      confirmed_at = now(),
      updated_at = now(),
      failure_code = NULL,
      failure_message = NULL
  WHERE id = v_order.id;

  IF v_order.base_credit > 0 THEN
    INSERT INTO public.credit_ledger (
      org_id, delta, kind, ref, expires_at, idempotency_key,
      payment_order_id, refundable, source_bucket
    ) VALUES (
      v_order.facility_id,
      v_order.base_credit,
      'earn',
      v_order.order_id || ':base',
      v_expires_at,
      'payment-credit:' || v_order.order_id || ':base',
      v_order.id,
      true,
      'paid'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  IF v_order.bonus_credit > 0 THEN
    INSERT INTO public.credit_ledger (
      org_id, delta, kind, ref, expires_at, idempotency_key,
      payment_order_id, refundable, source_bucket
    ) VALUES (
      v_order.facility_id,
      v_order.bonus_credit,
      'earn',
      v_order.order_id || ':bonus',
      v_expires_at,
      'payment-credit:' || v_order.order_id || ':bonus',
      v_order.id,
      false,
      'bonus'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    'system', v_order.requested_by, 'payment.credit.finalize', 'payment_order', v_order.id,
    jsonb_build_object(
      'order_id', v_order.order_id,
      'amount', v_order.amount,
      'credited', v_order.base_credit + v_order.bonus_credit
    )
  );

  RETURN jsonb_build_object(
    'orderId', v_order.order_id,
    'credited', v_order.base_credit + v_order.bonus_credit,
    'alreadyProcessed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_reconciliation(
  p_order_id text,
  p_status text,
  p_provider_payload jsonb,
  p_failure_code text DEFAULT NULL,
  p_failure_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_next_status text;
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'service_role required'; END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment order not found'; END IF;

  -- A provider-side cancellation after credits were issued must be reviewed;
  -- automatically reversing already-spent credits can create an unbounded loss.
  IF v_order.status = 'paid' AND upper(COALESCE(p_status, '')) IN ('CANCELED','PARTIAL_CANCELED') THEN
    v_next_status := 'reconcile_required';
  ELSE
    v_next_status := CASE
      WHEN upper(COALESCE(p_status, '')) IN ('CANCELED','ABORTED','EXPIRED') THEN 'cancelled'
      WHEN upper(COALESCE(p_status, '')) = 'PARTIAL_CANCELED' THEN 'partial_cancelled'
      WHEN upper(COALESCE(p_status, '')) = 'DONE' THEN 'reconcile_required'
      ELSE 'failed'
    END;
  END IF;

  UPDATE public.payment_orders
  SET status = v_next_status,
      provider_status = p_status,
      provider_payload = COALESCE(p_provider_payload, '{}'::jsonb),
      failure_code = p_failure_code,
      failure_message = left(p_failure_message, 1000),
      updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    'system', v_order.requested_by, 'payment.reconciliation', 'payment_order', v_order.id,
    jsonb_build_object(
      'local_status', v_next_status,
      'provider_status', p_status,
      'failure_code', p_failure_code
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_credit_payment(text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_payment_reconciliation(text,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_credit_payment(text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_reconciliation(text,text,jsonb,text,text) TO service_role;

ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

-- ---------------------------------------------------------------------------
-- Worker credit payout: reserve funds immediately in the same transaction.
-- A rejected payout must be released with process_credit_payout().
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_credit_ledger_ref_kind
  ON public.worker_credit_ledger(worker_id, kind, ref)
  WHERE ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_my_credit_balance()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(l.delta), 0)::integer
  FROM public.worker_credit_ledger AS l
  WHERE l.worker_id = public.current_worker_id();
$$;

CREATE OR REPLACE FUNCTION public.request_credit_payout(p_amount integer)
RETURNS public.credit_payout_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_balance integer;
  v_bank record;
  v_request public.credit_payout_requests%ROWTYPE;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;
  IF p_amount < 1000 THEN RAISE EXCEPTION '최소 환급 금액은 1,000원이에요'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_worker_id::text, 0));
  SELECT COALESCE(SUM(delta), 0)::integer INTO v_balance
  FROM public.worker_credit_ledger
  WHERE worker_id = v_worker_id;
  IF p_amount > v_balance THEN RAISE EXCEPTION '환급 가능 금액을 초과했어요'; END IF;

  SELECT id, bank_name, account_number_last4, verification_status
  INTO v_bank
  FROM public.worker_bank_accounts
  WHERE worker_id = v_worker_id
    AND is_primary = true
    AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_bank.id IS NULL THEN RAISE EXCEPTION '등록된 계좌가 없어요'; END IF;
  IF v_bank.verification_status <> 'verified' THEN
    RAISE EXCEPTION '계좌 인증 완료 후 환급을 신청할 수 있어요';
  END IF;

  INSERT INTO public.credit_payout_requests (
    worker_id, amount, bank_name, account_last4, status
  ) VALUES (
    v_worker_id, p_amount, v_bank.bank_name, v_bank.account_number_last4, 'pending'
  ) RETURNING * INTO v_request;

  INSERT INTO public.worker_credit_ledger (
    worker_id, delta, kind, ref, memo
  ) VALUES (
    v_worker_id, -p_amount, 'payout', v_request.id::text, '환급 신청 예치'
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_credit_payout(
  p_request_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.credit_payout_requests%ROWTYPE;
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'service_role required'; END IF;
  IF p_status NOT IN ('paid','rejected') THEN RAISE EXCEPTION 'invalid payout status'; END IF;

  SELECT * INTO v_request
  FROM public.credit_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payout request not found'; END IF;
  IF v_request.status <> 'pending' THEN RETURN; END IF;

  UPDATE public.credit_payout_requests
  SET status = p_status, processed_at = now()
  WHERE id = p_request_id;

  IF p_status = 'rejected' THEN
    INSERT INTO public.worker_credit_ledger (
      worker_id, delta, kind, ref, memo
    ) VALUES (
      v_request.worker_id,
      v_request.amount,
      'adjust',
      p_request_id::text || ':release',
      '환급 거절 예치 해제'
    ) ON CONFLICT (worker_id, kind, ref) WHERE ref IS NOT NULL DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_credit_balance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_credit_payout(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_credit_payout(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_credit_balance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_credit_payout(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_credit_payout(uuid,text) TO service_role;

-- Outbox rows are claimed with service_role. SKIP LOCKED supports parallel cron workers.
CREATE OR REPLACE FUNCTION public.claim_notification_outbox(p_limit integer DEFAULT 25)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'service_role required'; END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.notification_outbox
    WHERE (
        (status IN ('pending','failed') AND next_attempt_at <= now())
        OR (status = 'processing' AND processing_started_at < now() - interval '10 minutes')
      )
      AND attempts < 8
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.notification_outbox AS outbox
  SET status = 'processing',
      attempts = attempts + 1,
      processing_started_at = now()
  FROM claimed
  WHERE outbox.id = claimed.id
  RETURNING outbox.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_notification_outbox(
  p_id uuid,
  p_status text,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'service_role required'; END IF;
  IF p_status NOT IN ('sent','failed','discarded') THEN RAISE EXCEPTION 'invalid outbox status'; END IF;

  UPDATE public.notification_outbox
  SET status = p_status,
      sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
      last_error = left(p_error, 1000),
      next_attempt_at = CASE
        WHEN p_status = 'failed' THEN now() + make_interval(mins => LEAST(60, power(2, LEAST(attempts, 6))::integer))
        ELSE next_attempt_at
      END,
      processing_started_at = NULL
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_outbox(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_notification_outbox(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_outbox(uuid,text,text) TO service_role;
