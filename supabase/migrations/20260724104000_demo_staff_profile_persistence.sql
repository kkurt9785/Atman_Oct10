-- Daily demo workforce refresh deletes/recreates rows. Keep showcase payroll
-- profiles attached at insert time so attendance -> payroll remains demonstrable.
CREATE OR REPLACE FUNCTION public.apply_demo_staff_payroll_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.phone LIKE 'DEMO-WF-%' THEN
    NEW.pay_basis:=CASE
      WHEN NEW.phone LIKE '%-1' OR NEW.phone LIKE '%-2' OR NEW.phone LIKE '%-5' THEN 'monthly'
      WHEN NEW.phone LIKE '%-3' THEN 'hourly' ELSE 'daily' END;
    NEW.pay_rate:=CASE
      WHEN NEW.phone LIKE '%-1' THEN 3200000 WHEN NEW.phone LIKE '%-2' THEN 2800000
      WHEN NEW.phone LIKE '%-3' THEN 18000 WHEN NEW.phone LIKE '%-4' THEN 150000
      ELSE 3000000 END;
    NEW.bank_name:=CASE
      WHEN NEW.phone LIKE '%-1' OR NEW.phone LIKE '%-4' THEN '국민은행'
      WHEN NEW.phone LIKE '%-2' OR NEW.phone LIKE '%-5' THEN '신한은행'
      ELSE '우리은행' END;
    NEW.account_last4:=CASE
      WHEN NEW.phone LIKE '%-1' THEN '1024' WHEN NEW.phone LIKE '%-2' THEN '2048'
      WHEN NEW.phone LIKE '%-3' THEN '3072' WHEN NEW.phone LIKE '%-4' THEN '4096'
      ELSE '5120' END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_apply_demo_staff_payroll_profile ON public.facility_staff;
CREATE TRIGGER trg_apply_demo_staff_payroll_profile
  BEFORE INSERT OR UPDATE OF phone ON public.facility_staff
  FOR EACH ROW EXECUTE FUNCTION public.apply_demo_staff_payroll_profile();
REVOKE ALL ON FUNCTION public.apply_demo_staff_payroll_profile() FROM PUBLIC,anon,authenticated;

UPDATE public.facility_staff SET phone=phone WHERE phone LIKE 'DEMO-WF-%';
