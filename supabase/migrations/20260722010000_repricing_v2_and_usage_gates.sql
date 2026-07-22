-- Pricing v2, legacy subscription migration, and atomic server-side usage gates.

UPDATE public.service_plans SET is_active = false
WHERE code IN ('starter', 'growth', 'network');

INSERT INTO public.service_plans
  (code, name, monthly_fee, included_facilities, included_admin_seats,
   included_active_workers, included_attendance_slots, included_job_posting_slots,
   features, is_active, sort_order)
VALUES
  ('free', 'Free 파일럿', 0, 1, 1, 0, 999999, 3,
   '{"support":"standard","credential_status":true,"popular":false,"tagline":"월 3건으로 직접 확인하는 병원 인력 운영"}', true, 10),
  ('basic', 'Basic', 79000, 1, 2, 20, 999999, 15,
   '{"support":"standard","credential_status":true,"repeat_invite":true,"popular":false,"tagline":"소형 병원의 반복 인력 운영"}', true, 20),
  ('pro', 'Pro', 149000, 1, 5, 60, 999999, 999999,
   '{"support":"priority","credential_status":true,"license_verification":true,"license_monitoring":true,"repeat_invite":true,"analytics":true,"operations":true,"popular":true,"tagline":"인력 공백과 반복근무를 자동화하는 주력 플랜"}', true, 30),
  ('enterprise', 'Enterprise', 399000, 3, 15, 999999, 999999, 999999,
   '{"support":"dedicated","credential_status":true,"license_verification":true,"license_monitoring":true,"repeat_invite":true,"analytics":true,"operations":true,"api":true,"audit_log":true,"custom_pricing":true,"popular":false,"tagline":"대형·종합병원 및 다병원 통합 운영"}', true, 40)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, monthly_fee = EXCLUDED.monthly_fee,
  included_facilities = EXCLUDED.included_facilities,
  included_admin_seats = EXCLUDED.included_admin_seats,
  included_active_workers = EXCLUDED.included_active_workers,
  included_attendance_slots = EXCLUDED.included_attendance_slots,
  included_job_posting_slots = EXCLUDED.included_job_posting_slots,
  features = EXCLUDED.features, is_active = true, sort_order = EXCLUDED.sort_order;

ALTER TABLE public.facility_subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at date,
  ADD COLUMN IF NOT EXISTS trial_converted_at timestamptz;

-- Preserve the closest product tier for current and historical subscriptions.
UPDATE public.facility_subscriptions
SET plan_code = CASE plan_code
  WHEN 'starter' THEN 'basic'
  WHEN 'growth' THEN 'pro'
  WHEN 'network' THEN 'enterprise'
END,
updated_at = now()
WHERE plan_code IN ('starter', 'growth', 'network');

-- Every new facility receives one 30-calendar-day Pro trial. The subscription
-- remains the source of truth, so all API/UI gates see the same entitlement.
CREATE OR REPLACE FUNCTION public.start_facility_pro_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_today date := (timezone('Asia/Seoul', now()))::date;
BEGIN
  INSERT INTO public.facility_subscriptions (
    facility_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, trial_started_at, trial_ends_at
  )
  SELECT NEW.id, 'pro', 'active', 'monthly', v_today, v_today + 29, now(), v_today + 29
  WHERE NOT EXISTS (
    SELECT 1 FROM public.facility_subscriptions
    WHERE facility_id = NEW.id AND status IN ('pending', 'active', 'past_due')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_facility_pro_trial ON public.facilities;
CREATE TRIGGER trg_start_facility_pro_trial
  AFTER INSERT ON public.facilities
  FOR EACH ROW EXECUTE FUNCTION public.start_facility_pro_trial();

-- One-time pilot grant for existing facilities that have never had a current subscription.
INSERT INTO public.facility_subscriptions (
  facility_id, plan_code, status, billing_cycle,
  current_period_start, current_period_end, trial_started_at, trial_ends_at
)
SELECT f.id, 'pro', 'active', 'monthly', k.today, k.today + 29, now(), k.today + 29
FROM public.facilities f
CROSS JOIN (SELECT (timezone('Asia/Seoul', now()))::date AS today) k
WHERE f.is_active = true
  AND f.deleted_at IS NULL
  AND NOT EXISTS (
  SELECT 1 FROM public.facility_subscriptions fs
  WHERE fs.facility_id = f.id AND fs.status IN ('pending', 'active', 'past_due')
);

CREATE OR REPLACE FUNCTION public.expire_service_trials()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.is_service_role() THEN RAISE EXCEPTION 'service_role required'; END IF;
  UPDATE public.facility_subscriptions
  SET status = 'expired', updated_at = now()
  WHERE status IN ('active', 'past_due', 'pending')
    AND trial_ends_at IS NOT NULL
    AND trial_converted_at IS NULL
    AND trial_ends_at < (timezone('Asia/Seoul', now()))::date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_service_trials() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_service_trials() TO service_role;

-- A paid invoice converts the trial in the same transaction as payment finalization.
CREATE OR REPLACE FUNCTION public.mark_trial_converted_on_invoice_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.subscription_id IS NOT NULL THEN
    UPDATE public.facility_subscriptions
    SET trial_converted_at = COALESCE(trial_converted_at, now()),
        trial_ends_at = NULL,
        updated_at = now()
    WHERE id = NEW.subscription_id AND trial_started_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_mark_trial_converted ON public.service_invoices;
CREATE TRIGGER trg_mark_trial_converted
  AFTER UPDATE OF status ON public.service_invoices
  FOR EACH ROW EXECUTE FUNCTION public.mark_trial_converted_on_invoice_payment();

CREATE OR REPLACE FUNCTION public.consume_service_plan_usage(
  p_facility_id uuid,
  p_usage_type text,
  p_quantity integer,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan public.service_plans%ROWTYPE;
  v_limit integer;
  v_used integer;
  v_period_start timestamptz := date_trunc('month', timezone('Asia/Seoul', now())) AT TIME ZONE 'Asia/Seoul';
BEGIN
  IF p_quantity <= 0 OR p_usage_type NOT IN ('job_posting_slot', 'active_worker') THEN
    RAISE EXCEPTION 'invalid service usage request';
  END IF;

  -- Serialize quota consumption per facility/month/type to prevent concurrent overages.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_facility_id::text || ':' || p_usage_type || ':' || v_period_start::text, 0
  ));

  IF EXISTS (SELECT 1 FROM public.service_usage_events WHERE idempotency_key = p_idempotency_key) THEN
    RETURN jsonb_build_object('allowed', true, 'duplicate', true);
  END IF;

  SELECT sp.* INTO v_plan
  FROM public.facility_subscriptions fs
  JOIN public.service_plans sp ON sp.code = fs.plan_code
  WHERE fs.facility_id = p_facility_id
    AND fs.status IN ('active', 'past_due', 'pending')
    AND (fs.trial_ends_at IS NULL OR fs.trial_ends_at >= (timezone('Asia/Seoul', now()))::date)
  ORDER BY CASE fs.status WHEN 'active' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END, fs.updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM public.service_plans WHERE code = 'free' AND is_active = true;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'free service plan is not configured'; END IF;

  v_limit := CASE p_usage_type
    WHEN 'job_posting_slot' THEN v_plan.included_job_posting_slots
    WHEN 'active_worker' THEN v_plan.included_active_workers
  END;

  SELECT COALESCE(sum(quantity), 0)::integer INTO v_used
  FROM public.service_usage_events
  WHERE facility_id = p_facility_id
    AND usage_type = p_usage_type
    AND occurred_at >= v_period_start
    AND metadata->>'plan_code' = v_plan.code;

  IF v_used + p_quantity > v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit,
                              'plan_code', v_plan.code, 'plan_name', v_plan.name);
  END IF;

  INSERT INTO public.service_usage_events
    (facility_id, usage_type, quantity, idempotency_key, metadata)
  VALUES
    (p_facility_id, p_usage_type, p_quantity, p_idempotency_key,
     jsonb_build_object('plan_code', v_plan.code, 'period_start', v_period_start));

  RETURN jsonb_build_object('allowed', true, 'used', v_used + p_quantity, 'limit', v_limit,
                            'plan_code', v_plan.code, 'plan_name', v_plan.name);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_service_plan_usage(uuid,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_service_plan_usage(uuid,text,integer,text) TO service_role;
