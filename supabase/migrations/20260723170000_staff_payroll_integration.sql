-- Unify hospital-managed employee payroll with marketplace wage instructions.
-- Amounts are hospital-entered estimates; Atman never holds or transfers wages.

ALTER TABLE public.facility_staff
  ADD COLUMN IF NOT EXISTS pay_basis text
    CHECK (pay_basis IN ('monthly','hourly','daily')),
  ADD COLUMN IF NOT EXISTS pay_rate integer
    CHECK (pay_rate IS NULL OR pay_rate > 0);

CREATE TABLE IF NOT EXISTS public.staff_wage_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  period_month date NOT NULL CHECK (period_month = date_trunc('month',period_month)::date),
  pay_basis text NOT NULL CHECK (pay_basis IN ('monthly','hourly','daily')),
  pay_rate integer NOT NULL CHECK (pay_rate > 0),
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  worked_days integer NOT NULL DEFAULT 0 CHECK (worked_days >= 0),
  gross_amount integer NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  net_amount integer NOT NULL DEFAULT 0 CHECK (net_amount >= 0),
  deduction_status text NOT NULL DEFAULT 'unconfirmed'
    CHECK (deduction_status IN ('unconfirmed','confirmed')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','exported','paid','cancelled')),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  exported_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_id,period_month)
);
CREATE INDEX IF NOT EXISTS idx_staff_wage_payments_facility_month
  ON public.staff_wage_payments(facility_id,period_month,status);
ALTER TABLE public.staff_wage_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_wage_payments_admin_read ON public.staff_wage_payments;
CREATE POLICY staff_wage_payments_admin_read ON public.staff_wage_payments FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE ALL ON public.staff_wage_payments FROM anon, authenticated;
GRANT SELECT ON public.staff_wage_payments TO authenticated;

COMMENT ON COLUMN public.facility_staff.pay_rate IS '병원이 입력한 세전 급여 기준액. monthly=월급, hourly=시급, daily=일급.';
COMMENT ON TABLE public.staff_wage_payments IS '병원 직접등록 직원의 월별 예상 급여 및 직접 지급 상태. Atman은 임금을 보관·이체하지 않는다.';
