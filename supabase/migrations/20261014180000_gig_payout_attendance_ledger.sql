-- Keep existing payouts intact: NULL means legacy date/time coverage.
-- New payouts retain exact attendance IDs, so cancellation releases only their rows.
ALTER TABLE public.gig_payouts ADD COLUMN IF NOT EXISTS attendance_ids uuid[];
DROP INDEX IF EXISTS public.uq_gig_payouts_active_staff_covered;

CREATE OR REPLACE FUNCTION public.guard_gig_payout_attendances()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;
  v_count integer; v_minutes integer; v_days integer; v_amount integer;
  v_first date; v_last date; v_out timestamptz; v_tax integer; v_income integer;
BEGIN
  -- Serializes all writes for a worker, including cancelling an earlier payout.
  SELECT * INTO v_staff FROM public.facility_staff WHERE id = NEW.staff_id FOR UPDATE;
  IF NOT FOUND OR v_staff.facility_id <> NEW.facility_id THEN
    RAISE EXCEPTION '근무지와 근무자 정보를 확인해 주세요.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','paid_at','pay_at','updated_at','worker_confirm_status','worker_confirmed_at','worker_confirm_note'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','paid_at','pay_at','updated_at','worker_confirm_status','worker_confirmed_at','worker_confirm_note']) THEN
      RAISE EXCEPTION '이미 기록한 지급 내역은 변경할 수 없어요. 지급 예정을 취소한 뒤 다시 기록해 주세요.';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'scheduled' AND NEW.status IN ('paid','cancelled')) THEN
      RAISE EXCEPTION '이미 처리된 지급 상태는 변경할 수 없어요.';
    END IF;
    RETURN NEW;
  END IF;
  IF v_staff.worker_kind <> 'gig' OR NEW.pay_basis NOT IN ('hourly','daily') THEN
    RAISE EXCEPTION '단기근로 지급은 시급·일급 근무자만 처리할 수 있어요.';
  END IF;
  IF NEW.attendance_ids IS NULL OR cardinality(NEW.attendance_ids) = 0 THEN
    RAISE EXCEPTION '지급에 포함할 근태 기록이 필요해요. 화면을 새로고침해 주세요.';
  END IF;
  -- Freeze the selected records while validating the calculation and overlap.
  PERFORM id FROM public.staff_attendances WHERE id = ANY(NEW.attendance_ids) ORDER BY id FOR UPDATE;
  SELECT count(*), count(DISTINCT work_date), min(work_date), max(work_date), max(check_out_at),
    sum(greatest(0, round(extract(epoch FROM (check_out_at - check_in_at)) / 60)::integer - greatest(0, coalesce(break_minutes, 0))))
  INTO v_count, v_days, v_first, v_last, v_out, v_minutes
  FROM public.staff_attendances
  WHERE id = ANY(NEW.attendance_ids) AND staff_id = NEW.staff_id AND facility_id = NEW.facility_id
    AND status = 'completed' AND check_in_at IS NOT NULL AND check_out_at >= check_in_at
    AND work_date <= (now() AT TIME ZONE 'Asia/Seoul')::date;
  IF v_count <> cardinality(NEW.attendance_ids) THEN
    RAISE EXCEPTION '근태가 변경됐거나 중복돼 있어요. 새로고침 후 다시 확인해 주세요.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gig_payouts p JOIN public.staff_attendances a ON a.id = ANY(NEW.attendance_ids)
    WHERE p.staff_id = NEW.staff_id AND p.status <> 'cancelled' AND (
      (p.attendance_ids IS NOT NULL AND a.id = ANY(p.attendance_ids)) OR
      (p.attendance_ids IS NULL AND a.work_date BETWEEN p.period_start AND p.period_end
        AND (p.covered_until IS NULL OR a.check_out_at <= p.covered_until))
    )
  ) THEN RAISE EXCEPTION '다른 지급에 이미 포함된 근무가 있어요. 새로고침 후 다시 확인해 주세요.'; END IF;
  -- A daily wage cannot be charged again just because a second record was added.
  IF NEW.pay_basis = 'daily' AND EXISTS (
    SELECT 1 FROM public.gig_payouts p JOIN public.staff_attendances a ON a.id = ANY(NEW.attendance_ids)
    WHERE p.staff_id = NEW.staff_id AND p.status <> 'cancelled' AND (
      (p.attendance_ids IS NULL AND a.work_date BETWEEN p.period_start AND p.period_end) OR
      EXISTS (SELECT 1 FROM public.staff_attendances old_a WHERE old_a.id = ANY(p.attendance_ids) AND old_a.work_date = a.work_date)
    )
  ) THEN RAISE EXCEPTION '이미 지급 기록이 있는 날짜예요. 일급이 중복되지 않도록 기존 지급 내역을 확인해 주세요.'; END IF;
  v_amount := CASE NEW.pay_basis WHEN 'hourly' THEN round(v_minutes::numeric * v_staff.pay_rate / 60)::integer ELSE v_days * v_staff.pay_rate END;
  v_income := CASE WHEN NEW.withholding_rate = 0.033 THEN floor(v_amount::numeric * 0.03 / 10)::integer * 10 ELSE 0 END;
  v_tax := v_income + floor(v_income::numeric * 0.1 / 10)::integer * 10;
  IF NEW.pay_basis IS DISTINCT FROM v_staff.pay_basis OR NEW.pay_rate IS DISTINCT FROM v_staff.pay_rate
     OR NEW.worked_minutes IS DISTINCT FROM v_minutes OR NEW.worked_days IS DISTINCT FROM v_days
     OR NEW.period_start IS DISTINCT FROM v_first OR NEW.period_end IS DISTINCT FROM v_last
     OR NEW.covered_until IS DISTINCT FROM v_out OR NEW.amount IS DISTINCT FROM v_amount OR v_amount <= 0
     OR NEW.withholding_rate NOT IN (0, 0.033) OR NEW.withholding_amount IS DISTINCT FROM v_tax
     OR NEW.net_amount IS DISTINCT FROM (v_amount - v_tax) THEN
    RAISE EXCEPTION '근태 또는 급여 기준이 바뀌었어요. 새로고침 후 금액을 다시 확인해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_gig_payout_attendances() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_gig_payout_attendances
BEFORE INSERT OR UPDATE ON public.gig_payouts
FOR EACH ROW EXECUTE FUNCTION public.guard_gig_payout_attendances();

-- A default is a suggested break, not evidence of an actual break. In particular,
-- explicit zero must survive both checkout and later corrections.
CREATE OR REPLACE FUNCTION public.fill_staff_attendance_break()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fill_staff_attendance_break() FROM PUBLIC, anon, authenticated;
