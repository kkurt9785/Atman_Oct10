-- Do not invent historical rates or rewrite existing payroll. A worked gig contract
-- keeps its established rate, including after payment cancellation/reopening.
CREATE OR REPLACE FUNCTION public.protect_worked_gig_contract_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.worker_kind='gig' AND OLD.pay_rate IS NOT NULL AND OLD.pay_rate>0
     AND (NEW.pay_rate IS DISTINCT FROM OLD.pay_rate OR NEW.pay_basis IS DISTINCT FROM OLD.pay_basis)
     AND EXISTS (SELECT 1 FROM public.staff_attendances WHERE staff_id=OLD.id AND check_in_at IS NOT NULL) THEN
    RAISE EXCEPTION '근태 기록이 있는 계약의 급여 기준은 변경할 수 없어요. 기존 근무를 정산한 뒤 새 단가의 계약을 등록해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_worked_gig_contract_rate() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_worked_gig_contract_rate
BEFORE UPDATE OF pay_basis,pay_rate ON public.facility_staff
FOR EACH ROW EXECUTE FUNCTION public.protect_worked_gig_contract_rate();

-- Serialize first attendance with concurrent contract edits. Payouts already lock
-- the same staff row. No historical rates are inferred/backfilled by this migration.
CREATE OR REPLACE FUNCTION public.lock_staff_contract_for_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM id FROM public.facility_staff WHERE id=NEW.staff_id FOR UPDATE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_staff_contract_for_attendance() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lock_staff_contract_for_attendance
BEFORE INSERT ON public.staff_attendances
FOR EACH ROW EXECUTE FUNCTION public.lock_staff_contract_for_attendance();
