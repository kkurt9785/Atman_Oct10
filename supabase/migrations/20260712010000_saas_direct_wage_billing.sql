-- Atman SaaS billing + hospital-direct wage payment.
-- Legacy credit, settlement and payout rows are intentionally retained read-only.

CREATE TABLE IF NOT EXISTS public.wage_payment_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  attendance_id uuid NOT NULL UNIQUE REFERENCES public.shift_attendances(id) ON DELETE RESTRICT,
  wage_calculation_id uuid REFERENCES public.wage_calculations(id) ON DELETE RESTRICT,
  bank_account_id uuid REFERENCES public.worker_bank_accounts(id) ON DELETE RESTRICT,
  gross_amount integer NOT NULL CHECK (gross_amount >= 0),
  deduction_status text NOT NULL DEFAULT 'unconfirmed'
    CHECK (deduction_status IN ('unconfirmed','hospital_confirmed','not_applicable')),
  income_tax_amount integer NOT NULL DEFAULT 0 CHECK (income_tax_amount >= 0),
  local_tax_amount integer NOT NULL DEFAULT 0 CHECK (local_tax_amount >= 0),
  other_deduction_amount integer NOT NULL DEFAULT 0 CHECK (other_deduction_amount >= 0),
  net_amount integer NOT NULL CHECK (net_amount >= 0),
  currency text NOT NULL DEFAULT 'KRW' CHECK (currency = 'KRW'),
  due_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','exported','paid','worker_confirmed','disputed','cancelled')),
  bank_name_snapshot text,
  account_last4_snapshot text,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  exported_at timestamptz,
  paid_at timestamptz,
  worker_confirmed_at timestamptz,
  dispute_reason text,
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wpi_facility_status ON public.wage_payment_instructions(facility_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wpi_worker_created ON public.wage_payment_instructions(worker_id, created_at DESC);
ALTER TABLE public.wage_payment_instructions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wage_payment_worker_read ON public.wage_payment_instructions;
CREATE POLICY wage_payment_worker_read ON public.wage_payment_instructions FOR SELECT
  USING (worker_id IN (SELECT w.id FROM public.workers w WHERE w.auth_user_id = auth.uid()));
DROP POLICY IF EXISTS wage_payment_facility_read ON public.wage_payment_instructions;
CREATE POLICY wage_payment_facility_read ON public.wage_payment_instructions FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.wage_payment_instructions FROM anon, authenticated;
GRANT SELECT ON public.wage_payment_instructions TO authenticated;

CREATE TABLE IF NOT EXISTS public.service_plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  monthly_fee integer NOT NULL CHECK (monthly_fee >= 0),
  included_facilities integer NOT NULL DEFAULT 1,
  included_admin_seats integer NOT NULL DEFAULT 1,
  included_active_workers integer NOT NULL DEFAULT 0,
  included_attendance_slots integer NOT NULL DEFAULT 0,
  included_job_posting_slots integer NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.service_plans(code,name,monthly_fee,included_facilities,included_admin_seats,included_active_workers,included_attendance_slots,included_job_posting_slots,features,sort_order)
VALUES
 ('starter','Starter',199000,1,2,10,10,10,'{"support":"standard"}',10),
 ('growth','Growth',599000,3,5,40,40,50,'{"license_verification":true,"analytics":true}',20),
 ('network','Network',1290000,10,15,100,100,200,'{"license_verification":true,"analytics":true,"api":true,"audit_log":true}',30)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, monthly_fee=EXCLUDED.monthly_fee,
 included_facilities=EXCLUDED.included_facilities, included_admin_seats=EXCLUDED.included_admin_seats,
 included_active_workers=EXCLUDED.included_active_workers, included_attendance_slots=EXCLUDED.included_attendance_slots,
 included_job_posting_slots=EXCLUDED.included_job_posting_slots, features=EXCLUDED.features, sort_order=EXCLUDED.sort_order;
ALTER TABLE public.service_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_plans_read ON public.service_plans;
CREATE POLICY service_plans_read ON public.service_plans FOR SELECT USING (is_active = true);
GRANT SELECT ON public.service_plans TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.facility_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
  plan_code text NOT NULL REFERENCES public.service_plans(code),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','past_due','cancelled','expired')),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual')),
  current_period_start date,
  current_period_end date,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_subscription_current ON public.facility_subscriptions(facility_id) WHERE status IN ('pending','active','past_due');
ALTER TABLE public.facility_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facility_subscriptions_read ON public.facility_subscriptions;
CREATE POLICY facility_subscriptions_read ON public.facility_subscriptions FOR SELECT USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.facility_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.facility_subscriptions TO authenticated;

CREATE TABLE IF NOT EXISTS public.service_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
  usage_type text NOT NULL CHECK (usage_type IN ('facility_location','admin_seat','active_worker','attendance_slot','job_posting_slot','license_verification','notification_usage','api_usage','erp_integration','job_boost')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  idempotency_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_usage_read ON public.service_usage_events;
CREATE POLICY service_usage_read ON public.service_usage_events FOR SELECT USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.service_usage_events FROM anon, authenticated;
GRANT SELECT ON public.service_usage_events TO authenticated;

CREATE TABLE IF NOT EXISTS public.service_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES public.facility_subscriptions(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  subtotal integer NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount integer NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount integer NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paying','paid','void','overdue')),
  due_date date,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.service_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.service_invoices(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('base_subscription','facility_location','admin_seat','active_worker','attendance_slot','job_posting_slot','license_verification','notification_usage','api_usage','erp_integration','job_boost')),
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount integer NOT NULL CHECK (unit_amount >= 0),
  amount integer NOT NULL CHECK (amount >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount = quantity * unit_amount)
);
ALTER TABLE public.service_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_invoice_read ON public.service_invoices;
CREATE POLICY service_invoice_read ON public.service_invoices FOR SELECT USING (public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS service_invoice_item_read ON public.service_invoice_items;
CREATE POLICY service_invoice_item_read ON public.service_invoice_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.service_invoices i WHERE i.id=invoice_id AND public.facility_access_role(i.facility_id) IS NOT NULL));
REVOKE INSERT, UPDATE, DELETE ON public.service_invoices, public.service_invoice_items FROM anon, authenticated;
GRANT SELECT ON public.service_invoices, public.service_invoice_items TO authenticated;

ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'legacy_credit';
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS service_invoice_id uuid REFERENCES public.service_invoices(id) ON DELETE RESTRICT;
ALTER TABLE public.payment_orders ALTER COLUMN tier_id DROP NOT NULL;
ALTER TABLE public.payment_orders ALTER COLUMN base_credit SET DEFAULT 0;
ALTER TABLE public.payment_orders ALTER COLUMN bonus_credit SET DEFAULT 0;
ALTER TABLE public.payment_orders DROP CONSTRAINT IF EXISTS payment_orders_order_type_check;
ALTER TABLE public.payment_orders ADD CONSTRAINT payment_orders_order_type_check CHECK (order_type IN ('legacy_credit','service_invoice'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_service_invoice ON public.payment_orders(service_invoice_id) WHERE service_invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.finalize_service_invoice_payment(p_order_id text,p_payment_key text,p_provider_status text,p_provider_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order public.payment_orders%ROWTYPE; v_invoice public.service_invoices%ROWTYPE;
BEGIN
 IF NOT public.is_service_role() THEN RAISE EXCEPTION 'service_role required'; END IF;
 SELECT * INTO v_order FROM public.payment_orders WHERE order_id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.order_type <> 'service_invoice' OR v_order.service_invoice_id IS NULL THEN RAISE EXCEPTION 'service invoice order not found'; END IF;
 SELECT * INTO v_invoice FROM public.service_invoices WHERE id=v_order.service_invoice_id FOR UPDATE;
 IF v_order.status='paid' THEN RETURN jsonb_build_object('orderId',v_order.order_id,'invoiceId',v_invoice.id,'alreadyProcessed',true); END IF;
 IF upper(COALESCE(p_provider_status,'')) <> 'DONE' OR p_provider_payload->>'orderId' IS DISTINCT FROM v_order.order_id OR
    p_provider_payload->>'paymentKey' IS DISTINCT FROM p_payment_key OR COALESCE((p_provider_payload->>'totalAmount')::integer,-1) <> v_invoice.total_amount OR v_order.amount <> v_invoice.total_amount
 THEN RAISE EXCEPTION 'provider payment mismatch'; END IF;
 UPDATE public.payment_orders SET status='paid',provider_payment_key=p_payment_key,provider_status=p_provider_status,provider_payload=p_provider_payload,confirmed_at=now(),updated_at=now() WHERE id=v_order.id;
 UPDATE public.service_invoices SET status='paid',paid_at=now(),updated_at=now() WHERE id=v_invoice.id;
 UPDATE public.facility_subscriptions SET status='active',current_period_start=v_invoice.period_start,current_period_end=v_invoice.period_end,updated_at=now() WHERE id=v_invoice.subscription_id;
 INSERT INTO public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,after_data) VALUES ('system',v_order.requested_by,'service_invoice.payment.finalize','service_invoice',v_invoice.id,jsonb_build_object('amount',v_invoice.total_amount,'order_id',v_order.order_id));
 RETURN jsonb_build_object('orderId',v_order.order_id,'invoiceId',v_invoice.id,'alreadyProcessed',false);
END $$;
REVOKE ALL ON FUNCTION public.finalize_service_invoice_payment(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_service_invoice_payment(text,text,text,jsonb) TO service_role;

-- Cash-out is closed for all new requests. Historical rows remain readable.
REVOKE ALL ON FUNCTION public.request_credit_payout(integer) FROM PUBLIC, anon, authenticated;

-- Preserve the audited QR/geofence/nonce implementation while replacing only
-- the legacy money flow in the current production function definition.
DO $patch$
DECLARE v_sql text;
BEGIN
  SELECT pg_get_functiondef('public.consume_attendance_qr(text,uuid,double precision,double precision)'::regprocedure) INTO v_sql;
  v_sql := replace(v_sql,
$old$  v_platform_fee := round(v_gross * COALESCE(v_shift.platform_fee_rate, 0.12))::integer;
  v_charge := v_gross + v_platform_fee;

  -- Serialize all spend operations per facility to prevent negative-balance races.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text, 0));
  v_balance := public.org_credit_balance(p_facility_id);
  IF v_balance IS NULL OR v_balance < v_charge THEN
    RAISE EXCEPTION '크레딧이 부족해요. 필요 금액: %, 현재 잔액: %', v_charge, COALESCE(v_balance, 0);
  END IF;$old$,
$new$  -- SaaS direct-wage model: no wage-linked platform fee and no facility credit spend.
  v_platform_fee := 0;
  v_charge := 0;
  v_balance := 0;$new$);

  v_sql := replace(v_sql,
$old$  v_income_tax := round(v_gross * 0.03)::integer;
  v_local_tax := round(v_income_tax * 0.1)::integer;
  v_net_pay := v_gross - v_income_tax - v_local_tax;$old$,
$new$  -- Employment/tax classification is decided by the hospital, not Atman.
  v_income_tax := 0;
  v_local_tax := 0;
  v_net_pay := v_gross;$new$);

  v_sql := replace(v_sql,
$old$  INSERT INTO public.settlements (
    shift_id, worker_id, attendance_id, bank_account_id,
    gross_pay, platform_fee, income_tax, local_tax, net_pay, status
  ) VALUES (
    v_shift.id, v_worker.id, v_attendance.id, v_bank_id,
    v_gross, v_platform_fee, v_income_tax, v_local_tax, v_net_pay, 'pending'
  ) ON CONFLICT (attendance_id) DO NOTHING;$old$,
$new$  INSERT INTO public.wage_payment_instructions (
    facility_id, worker_id, shift_id, attendance_id, wage_calculation_id,
    bank_account_id, gross_amount, deduction_status, net_amount, due_date,
    bank_name_snapshot, account_last4_snapshot
  ) VALUES (
    p_facility_id, v_worker.id, v_shift.id, v_attendance.id,
    (SELECT id FROM public.wage_calculations WHERE attendance_id=v_attendance.id),
    v_bank_id, v_gross, 'unconfirmed', v_gross, v_shift.shift_date + 7,
    (SELECT bank_name FROM public.worker_bank_accounts WHERE id=v_bank_id),
    (SELECT account_number_last4 FROM public.worker_bank_accounts WHERE id=v_bank_id)
  ) ON CONFLICT (attendance_id) DO NOTHING;$new$);

  v_sql := replace(v_sql,
$old$  INSERT INTO public.credit_ledger (
    org_id, delta, kind, ref, created_at
  ) VALUES (
    p_facility_id, -v_charge, 'spend', v_shift.id::text, v_now
  );$old$,
$new$  -- No credit ledger entry: the hospital pays the worker directly.$new$);

  v_sql := replace(v_sql,
    '''gross'',v_gross,''platform_fee'',v_platform_fee,''charged'',v_charge',
    '''gross'',v_gross,''payment_model'',''direct_hospital_pay''');
  v_sql := replace(v_sql,
    '''체크아웃과 정산 등록이 완료됐어요''',
    '''근무 기록과 지급 요청이 등록됐어요''');
  v_sql := replace(v_sql,
    'format(''총 임금 ₩%s · 정산 예정 ₩%s'', to_char(v_gross,''FM999,999,999''), to_char(v_net_pay,''FM999,999,999''))',
    'format(''예상 세전액 ₩%s · 병원 직접 지급 예정'', to_char(v_gross,''FM999,999,999''))');
  v_sql := replace(v_sql,
$old$    'gross',v_gross,
    'platformFee',v_platform_fee,
    'charged',v_charge,
    'netPay',v_net_pay,
    'balance',v_balance - v_charge,
    'distanceM',v_distance$old$,
$new$    'gross',v_gross,
    'estimatedDeductions',0,
    'estimatedNet',v_gross,
    'deductionStatus','unconfirmed',
    'paymentStatus','draft',
    'paymentInstructionId',(SELECT id FROM public.wage_payment_instructions WHERE attendance_id=v_attendance.id),
    'distanceM',v_distance$new$);

  IF v_sql LIKE '%크레딧이 부족해요%' OR v_sql LIKE '%INSERT INTO public.settlements (%' OR v_sql LIKE '%INSERT INTO public.credit_ledger (%' THEN
    RAISE EXCEPTION 'consume_attendance_qr legacy money-flow replacement was incomplete';
  END IF;
  EXECUTE v_sql;
END $patch$;

CREATE OR REPLACE FUNCTION public.update_wage_payment_status(p_instruction_id uuid,p_action text,p_payment_reference text DEFAULT NULL,p_dispute_reason text DEFAULT NULL)
RETURNS public.wage_payment_instructions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.wage_payment_instructions%ROWTYPE; v_worker_id uuid; v_role text;
BEGIN
 SELECT * INTO v_row FROM public.wage_payment_instructions WHERE id=p_instruction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '지급 요청을 찾을 수 없어요'; END IF;
 SELECT id INTO v_worker_id FROM public.workers WHERE auth_user_id=auth.uid();
 v_role := public.facility_access_role(v_row.facility_id);
 IF p_action IN ('approve','mark_exported','mark_paid') THEN
   IF v_role IS NULL OR v_role NOT IN ('owner','super') THEN RAISE EXCEPTION '급여 승인 권한이 없어요'; END IF;
   IF p_action='approve' AND v_row.status='draft' THEN UPDATE public.wage_payment_instructions SET status='approved',approved_by=auth.uid(),approved_at=now(),updated_at=now() WHERE id=v_row.id;
   ELSIF p_action='mark_exported' AND v_row.status IN ('approved','exported') THEN UPDATE public.wage_payment_instructions SET status='exported',exported_at=COALESCE(exported_at,now()),updated_at=now() WHERE id=v_row.id;
   ELSIF p_action='mark_paid' AND v_row.status IN ('approved','exported') THEN UPDATE public.wage_payment_instructions SET status='paid',paid_at=now(),payment_reference=left(p_payment_reference,100),updated_at=now() WHERE id=v_row.id;
   ELSE RAISE EXCEPTION '허용되지 않는 지급 상태 전이예요'; END IF;
 ELSE
   IF v_worker_id IS DISTINCT FROM v_row.worker_id THEN RAISE EXCEPTION '본인의 지급 요청만 처리할 수 있어요'; END IF;
   IF p_action='confirm' AND v_row.status='paid' THEN UPDATE public.wage_payment_instructions SET status='worker_confirmed',worker_confirmed_at=now(),updated_at=now() WHERE id=v_row.id;
   ELSIF p_action='dispute' AND v_row.status IN ('approved','exported','paid') AND length(trim(COALESCE(p_dispute_reason,'')))>=5 THEN UPDATE public.wage_payment_instructions SET status='disputed',dispute_reason=left(trim(p_dispute_reason),1000),updated_at=now() WHERE id=v_row.id;
   ELSE RAISE EXCEPTION '허용되지 않는 요청이거나 이의 사유가 너무 짧아요'; END IF;
 END IF;
 SELECT * INTO v_row FROM public.wage_payment_instructions WHERE id=p_instruction_id;
 INSERT INTO public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,after_data) VALUES (CASE WHEN v_worker_id=v_row.worker_id THEN 'worker' ELSE 'admin' END,auth.uid(),'wage_payment.'||p_action,'wage_payment_instruction',v_row.id,jsonb_build_object('status',v_row.status));
 RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.update_wage_payment_status(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_wage_payment_status(uuid,text,text,text) TO authenticated;

COMMENT ON TABLE public.wage_payment_instructions IS '병원이 워커에게 직접 지급할 임금 지시. Atman은 임금을 수취하지 않는다.';
COMMENT ON TABLE public.service_invoices IS '워커 임금과 독립된 Atman SaaS 이용료 청구서.';
