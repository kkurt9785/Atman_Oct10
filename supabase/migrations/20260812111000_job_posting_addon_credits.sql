-- Paid plans may buy additional job-posting slots for the current month.
-- Customer-facing price is KRW 9,900 VAT included (supply 9,000 + VAT 900).
ALTER TABLE public.service_plans
  ADD COLUMN IF NOT EXISTS job_posting_addon_price integer NOT NULL DEFAULT 9000
  CHECK (job_posting_addon_price >= 0);

UPDATE public.service_plans
SET job_posting_addon_price = CASE WHEN code = 'free' THEN 0 ELSE 9000 END;

CREATE TABLE IF NOT EXISTS public.service_addon_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
  service_invoice_id uuid NOT NULL UNIQUE REFERENCES public.service_invoices(id) ON DELETE RESTRICT,
  addon_type text NOT NULL CHECK (addon_type IN ('job_posting_slot')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_service_addon_credits_lookup
  ON public.service_addon_credits(facility_id, addon_type, period_start, period_end);
ALTER TABLE public.service_addon_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_addon_credits_read ON public.service_addon_credits;
CREATE POLICY service_addon_credits_read ON public.service_addon_credits FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.service_addon_credits FROM anon, authenticated;
GRANT SELECT ON public.service_addon_credits TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_paid_service_addon()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    INSERT INTO public.service_addon_credits
      (facility_id, service_invoice_id, addon_type, period_start, period_end, quantity)
    SELECT NEW.facility_id, NEW.id, 'job_posting_slot', NEW.period_start, NEW.period_end,
           sum(item.quantity)::integer
    FROM public.service_invoice_items item
    WHERE item.invoice_id = NEW.id
      AND item.item_type = 'job_posting_slot'
      AND item.metadata->>'addon' = 'true'
    HAVING sum(item.quantity) > 0
    ON CONFLICT (service_invoice_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_paid_service_addon() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_grant_paid_service_addon ON public.service_invoices;
CREATE TRIGGER trg_grant_paid_service_addon
  AFTER UPDATE OF status ON public.service_invoices
  FOR EACH ROW EXECUTE FUNCTION public.grant_paid_service_addon();

CREATE OR REPLACE FUNCTION public.consume_service_plan_usage(
  p_facility_id uuid, p_usage_type text, p_quantity integer, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_plan public.service_plans%ROWTYPE;
  v_limit integer;
  v_used integer;
  v_addon_total integer := 0;
  v_addon_required integer := 0;
  v_period_start timestamptz := date_trunc('month', timezone('Asia/Seoul', now())) AT TIME ZONE 'Asia/Seoul';
  v_today date := (timezone('Asia/Seoul', now()))::date;
BEGIN
  IF p_quantity <= 0 OR p_usage_type NOT IN ('job_posting_slot', 'active_worker') THEN
    RAISE EXCEPTION 'invalid service usage request';
  END IF;
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
    AND (fs.trial_ends_at IS NULL OR fs.trial_ends_at >= v_today)
  ORDER BY CASE fs.status WHEN 'active' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END, fs.updated_at DESC
  LIMIT 1;
  IF NOT FOUND THEN SELECT * INTO v_plan FROM public.service_plans WHERE code = 'free' AND is_active = true; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'free service plan is not configured'; END IF;
  v_limit := CASE p_usage_type
    WHEN 'job_posting_slot' THEN v_plan.included_job_posting_slots
    WHEN 'active_worker' THEN v_plan.included_active_workers
  END;
  SELECT COALESCE(sum(quantity), 0)::integer INTO v_used
  FROM public.service_usage_events
  WHERE facility_id = p_facility_id AND usage_type = p_usage_type AND occurred_at >= v_period_start;
  IF p_usage_type = 'job_posting_slot' THEN
    SELECT COALESCE(sum(quantity), 0)::integer INTO v_addon_total
    FROM public.service_addon_credits
    WHERE facility_id = p_facility_id AND addon_type = 'job_posting_slot'
      AND period_start <= v_today AND period_end >= v_today;
    v_addon_required := GREATEST(0, v_used + p_quantity - v_limit);
  END IF;
  IF v_used + p_quantity > v_limit + v_addon_total THEN
    RETURN jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit,
      'addon_total', v_addon_total, 'addon_price', v_plan.job_posting_addon_price,
      'plan_code', v_plan.code, 'plan_name', v_plan.name);
  END IF;
  INSERT INTO public.service_usage_events(facility_id, usage_type, quantity, idempotency_key, metadata)
  VALUES (p_facility_id, p_usage_type, p_quantity, p_idempotency_key,
    jsonb_build_object('plan_code', v_plan.code, 'period_start', v_period_start,
      'addon_used', LEAST(p_quantity, v_addon_required)));
  RETURN jsonb_build_object('allowed', true, 'used', v_used + p_quantity, 'limit', v_limit,
    'addon_total', v_addon_total,
    'addon_remaining', GREATEST(0, v_addon_total - v_addon_required),
    'plan_code', v_plan.code, 'plan_name', v_plan.name);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_service_plan_usage(uuid,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_service_plan_usage(uuid,text,integer,text) TO service_role;
