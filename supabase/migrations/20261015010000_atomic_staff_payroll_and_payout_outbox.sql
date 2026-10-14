-- Apply after the payroll permission and atomic attendance-correction migrations.
-- No existing amounts are rewritten. App rollout must follow this migration.
CREATE OR REPLACE FUNCTION public.transition_staff_wage_payment(
  p_facility_id uuid, p_staff_id uuid, p_month date, p_action text,
  p_final_gross integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;
  v_payment public.staff_wage_payments%ROWTYPE;
  v_exists boolean; v_minutes integer; v_days integer; v_gross integer;
  v_end date; v_prorate boolean; v_expected text; v_status text;
BEGIN
  IF auth.uid() IS NULL
    OR public.can_manage_facility(p_facility_id,ARRAY['owner','super']) IS NOT TRUE
    OR public.can_view_facility_payroll(p_facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION '급여 처리 권한이 없어요.';
  END IF;
  IF p_month IS NULL OR NOT isfinite(p_month) OR p_month<>date_trunc('month',p_month)::date
    OR p_action IS NULL OR p_action NOT IN ('approve','mark_exported','mark_paid') THEN
    RAISE EXCEPTION '급여기간과 처리 요청을 확인해 주세요.';
  END IF;
  -- Same lock order as period closure and attendance correction.
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance-period:'||p_facility_id::text||':'||p_month::text,0));
  SELECT * INTO v_staff FROM public.facility_staff WHERE id=p_staff_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '직원을 찾을 수 없어요.'; END IF;
  SELECT * INTO v_payment FROM public.staff_wage_payments WHERE staff_id=p_staff_id AND period_month=p_month FOR UPDATE;
  v_exists := FOUND;
  v_expected := CASE p_action WHEN 'approve' THEN 'draft' WHEN 'mark_exported' THEN 'approved' ELSE 'exported' END;
  v_status := CASE p_action WHEN 'approve' THEN 'approved' WHEN 'mark_exported' THEN 'exported' ELSE 'paid' END;
  IF (v_exists AND (v_payment.facility_id IS DISTINCT FROM p_facility_id OR v_payment.status IS DISTINCT FROM v_expected))
    OR (NOT v_exists AND p_action<>'approve') THEN
    RAISE EXCEPTION '현재 급여 상태에서는 처리할 수 없어요. 새로고침 후 확인해 주세요.';
  END IF;
  IF p_action='approve' THEN
    IF p_month>=date_trunc('month',now() AT TIME ZONE 'Asia/Seoul')::date THEN
      RAISE EXCEPTION '급여 승인은 마감된 이전 달부터 가능해요.';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.attendance_period_closures WHERE facility_id=p_facility_id AND period_month=p_month AND status='closed') THEN
      RAISE EXCEPTION '근태 내역에서 해당 월을 먼저 마감해 주세요.';
    END IF;
    IF v_staff.pay_basis IS NULL OR v_staff.pay_basis NOT IN ('monthly','hourly','daily') OR coalesce(v_staff.pay_rate,0)<=0 THEN
      RAISE EXCEPTION '직원의 급여 기준을 먼저 설정해 주세요.';
    END IF;
    IF v_staff.bank_name IS NULL OR trim(v_staff.bank_name)='' OR coalesce(v_staff.account_last4,'') !~ '^[0-9]{4}$' THEN
      RAISE EXCEPTION '지급 은행과 계좌 끝 4자리를 먼저 등록해 주세요.';
    END IF;
    v_end := (p_month+interval '1 month'-interval '1 day')::date;
    IF v_staff.contract_start>v_end OR v_staff.contract_end<p_month THEN
      RAISE EXCEPTION '이 직원의 계약기간과 급여기간이 겹치지 않아요.';
    END IF;
    IF EXISTS(SELECT 1 FROM public.gig_payouts WHERE staff_id=p_staff_id AND status<>'cancelled' AND period_start<=v_end AND period_end>=p_month) THEN
      RAISE EXCEPTION '이 기간에 단기근로 지급 기록이 있어요. 중복 지급 여부를 먼저 확인해 주세요.';
    END IF;
    PERFORM id FROM public.staff_attendances WHERE staff_id=p_staff_id AND facility_id=p_facility_id AND work_date BETWEEN p_month AND v_end ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.staff_attendances WHERE staff_id=p_staff_id AND facility_id=p_facility_id AND work_date BETWEEN p_month AND v_end
      AND ((check_in_at IS NOT NULL AND check_out_at IS NULL) OR status IN ('working','checkout_pending')
        OR (status='completed' AND (check_in_at IS NULL OR check_out_at IS NULL OR NOT isfinite(check_in_at) OR NOT isfinite(check_out_at) OR check_out_at<check_in_at)))) THEN
      RAISE EXCEPTION '완료되지 않았거나 잘못된 근태를 먼저 확인해 주세요.';
    END IF;
    SELECT coalesce(sum(greatest(0,round(extract(epoch FROM (check_out_at-check_in_at))/60)::integer-greatest(0,coalesce(break_minutes,0)))),0),count(DISTINCT work_date)
    INTO v_minutes,v_days FROM public.staff_attendances
    WHERE staff_id=p_staff_id AND facility_id=p_facility_id AND work_date BETWEEN p_month AND v_end AND status='completed';
    v_prorate := v_staff.pay_basis='monthly' AND (coalesce(v_staff.contract_start>p_month,false) OR coalesce(v_staff.contract_end<v_end,false));
    IF v_prorate AND coalesce(p_final_gross,0)<=0 THEN
      RAISE EXCEPTION '중도 계약 월은 일할계산한 최종 세전액을 입력해 주세요.';
    END IF;
    v_gross := CASE WHEN v_prorate THEN p_final_gross WHEN v_staff.pay_basis='monthly' THEN v_staff.pay_rate
      WHEN v_staff.pay_basis='daily' THEN v_days*v_staff.pay_rate ELSE round(v_minutes::numeric*v_staff.pay_rate/60)::integer END;
    IF v_gross<=0 THEN RAISE EXCEPTION '지급 승인할 근무·급여 금액이 없어요.'; END IF;
    INSERT INTO public.staff_wage_payments(facility_id,staff_id,period_month,pay_basis,pay_rate,worked_minutes,worked_days,gross_amount,net_amount,status,approved_by,approved_at,updated_at)
    VALUES(p_facility_id,p_staff_id,p_month,v_staff.pay_basis,v_staff.pay_rate,v_minutes,v_days,v_gross,v_gross,'approved',auth.uid(),now(),now())
    ON CONFLICT(staff_id,period_month) DO UPDATE SET pay_basis=EXCLUDED.pay_basis,pay_rate=EXCLUDED.pay_rate,
      worked_minutes=EXCLUDED.worked_minutes,worked_days=EXCLUDED.worked_days,gross_amount=EXCLUDED.gross_amount,net_amount=EXCLUDED.net_amount,
      status=EXCLUDED.status,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,updated_at=EXCLUDED.updated_at;
  ELSE
    -- Only status/timestamps change after approval; use the frozen wage snapshot.
    UPDATE public.staff_wage_payments SET status=v_status,updated_at=now(),
      exported_at=CASE WHEN p_action='mark_exported' THEN now() ELSE exported_at END,
      paid_at=CASE WHEN p_action='mark_paid' THEN now() ELSE paid_at END
    WHERE id=v_payment.id;
  END IF;
  INSERT INTO public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,after_data)
  VALUES('admin',auth.uid(),'staff_wage_payment.'||p_action,'facility_staff',p_staff_id,jsonb_build_object('period_month',p_month,'status',v_status));
END;
$$;
REVOKE ALL ON FUNCTION public.transition_staff_wage_payment(uuid,uuid,date,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_staff_wage_payment(uuid,uuid,date,text,integer) TO authenticated;

-- Symmetric check: a monthly approval and gig payout cannot cover the same month.
-- The existing attendance-ledger guard takes the same staff lock before this one.
CREATE OR REPLACE FUNCTION public.guard_gig_monthly_payroll_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM id FROM public.facility_staff WHERE id=NEW.staff_id FOR UPDATE;
  IF NEW.status<>'cancelled' AND EXISTS(SELECT 1 FROM public.staff_wage_payments
    WHERE staff_id=NEW.staff_id AND status IN ('approved','exported','paid')
      AND period_month<=NEW.period_end AND period_month+interval '1 month'>NEW.period_start) THEN
    RAISE EXCEPTION '이 기간에 확정된 월 급여가 있어요. 중복 지급 여부를 먼저 확인해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_gig_monthly_payroll_overlap() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_z_guard_gig_monthly_payroll_overlap BEFORE INSERT ON public.gig_payouts
FOR EACH ROW EXECUTE FUNCTION public.guard_gig_monthly_payroll_overlap();

-- Outbox insertion participates in the payout transaction. Dispatch remains async.
CREATE OR REPLACE FUNCTION public.enqueue_gig_payout_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid; v_facility text; v_kind text; v_key text; v_amount text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  END IF;
  IF NEW.status NOT IN ('scheduled','paid') THEN RETURN NEW; END IF;
  SELECT w.auth_user_id,f.name INTO v_user,v_facility
  FROM public.facility_staff fs JOIN public.workers w ON w.id=fs.worker_id
    JOIN public.facilities f ON f.id=fs.facility_id
  WHERE fs.id=NEW.staff_id AND fs.facility_id=NEW.facility_id;
  IF v_user IS NULL THEN RETURN NEW; END IF;
  v_kind := 'payout.'||NEW.status;
  -- Keep old server-action keys so a rolling app deployment cannot double-notify.
  v_key := v_kind||':'||NEW.id::text||CASE WHEN TG_OP='UPDATE' AND NEW.status='paid' THEN ':paid' ELSE '' END;
  v_amount := to_char(coalesce(NEW.net_amount,NEW.amount),'FM999,999,999,990');
  INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,title,body,data)
  VALUES(v_user,v_kind,v_key,coalesce(v_facility,'근무지')||CASE WHEN NEW.status='paid' THEN ' 급여 지급 완료' ELSE ' 급여 지급 예정' END,
    CASE WHEN NEW.status='paid' THEN v_amount||'원이 지급 처리됐어요. 입금을 확인해 주세요.'
      ELSE v_amount||'원이 '||coalesce(NEW.pay_at::text,'추후')||' 지급 예정으로 잡혔어요.' END,
    jsonb_build_object('url','/gig/settlement','kind',v_kind,'staff_id',NEW.staff_id,'payout_id',NEW.id))
  ON CONFLICT(dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_gig_payout_notice() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_enqueue_gig_payout_notice AFTER INSERT OR UPDATE OF status ON public.gig_payouts
FOR EACH ROW EXECUTE FUNCTION public.enqueue_gig_payout_notice();
