-- Central permission rule: active facility, own membership, matching demo realm.
CREATE OR REPLACE FUNCTION public.facility_access_role(p_facility_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN f.admin_user_id = auth.uid() THEN 'owner' ELSE a.access_role END
  FROM public.facilities f LEFT JOIN public.facility_admin_access a
    ON a.facility_id = f.id AND a.user_id = auth.uid()
  WHERE f.id = p_facility_id AND f.is_active AND f.deleted_at IS NULL
    AND auth.uid() IS NOT NULL
    AND coalesce(f.is_demo, false) = public.is_demo_account(auth.uid())
    AND (f.admin_user_id = auth.uid() OR a.user_id IS NOT NULL)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.facility_access_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_access_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_view_facility_payroll(p_facility_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.facility_access_role(p_facility_id) = 'owner' OR (
    public.facility_access_role(p_facility_id) IN ('operator','super','sales')
    AND EXISTS (SELECT 1 FROM public.facility_admin_access a
      WHERE a.facility_id=p_facility_id AND a.user_id=auth.uid() AND a.can_view_payroll)
  ), false);
$$;
REVOKE ALL ON FUNCTION public.can_view_facility_payroll(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_facility_payroll(uuid) TO authenticated;

DROP POLICY IF EXISTS gig_payouts_admin_read ON public.gig_payouts;
CREATE POLICY gig_payouts_admin_read ON public.gig_payouts FOR SELECT TO authenticated
  USING (public.can_view_facility_payroll(facility_id));
DROP POLICY IF EXISTS gig_bank_shares_admin_read ON public.gig_bank_account_shares;
CREATE POLICY gig_bank_shares_admin_read ON public.gig_bank_account_shares FOR SELECT TO authenticated
  USING (public.can_view_facility_payroll(facility_id));
DROP POLICY IF EXISTS staff_wage_payments_admin_read ON public.staff_wage_payments;
CREATE POLICY staff_wage_payments_admin_read ON public.staff_wage_payments FOR SELECT TO authenticated
  USING (public.can_view_facility_payroll(facility_id));
DROP POLICY IF EXISTS wage_payment_facility_read ON public.wage_payment_instructions;
CREATE POLICY wage_payment_facility_read ON public.wage_payment_instructions FOR SELECT TO authenticated
  USING (public.can_view_facility_payroll(facility_id));

-- Enforce the boundary on the underlying writes, including future invite RPCs.
CREATE OR REPLACE FUNCTION public.facility_worker_demo_scope_matches(p_facility_id uuid, p_worker_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.facilities f CROSS JOIN public.workers w
    WHERE f.id=p_facility_id AND w.id=p_worker_id
      AND coalesce(f.is_demo,false) = (coalesce(w.is_demo,false) OR public.is_demo_account(w.auth_user_id)));
$$;
REVOKE ALL ON FUNCTION public.facility_worker_demo_scope_matches(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_worker_demo_scope_matches(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_facility_worker_demo_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.worker_id IS NOT NULL AND NOT public.facility_worker_demo_scope_matches(NEW.facility_id,NEW.worker_id) THEN
    RAISE EXCEPTION '시연 계정과 실제 사업장은 서로 연결할 수 없어요. 시연 또는 내 계정을 확인해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_facility_worker_demo_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_facility_staff_demo_scope
BEFORE INSERT OR UPDATE OF worker_id, facility_id ON public.facility_staff
FOR EACH ROW EXECUTE FUNCTION public.guard_facility_worker_demo_scope();
CREATE TRIGGER trg_gig_bank_share_demo_scope
BEFORE INSERT OR UPDATE OF worker_id, facility_id ON public.gig_bank_account_shares
FOR EACH ROW EXECUTE FUNCTION public.guard_facility_worker_demo_scope();

-- Decrypt only after the same payroll gate used by the app and RLS.
-- Historical mixed demo/live links are excluded even before data reconciliation.
CREATE OR REPLACE FUNCTION public.get_gig_shared_bank_accounts(p_facility_id uuid)
RETURNS TABLE (staff_id uuid,bank_name text,account_number text,account_last4 text,account_holder_name text,shared_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_facility_payroll(p_facility_id)
     OR NOT coalesce(public.can_manage_facility(p_facility_id,ARRAY['owner','operator','super']::text[]),false) THEN
    RAISE EXCEPTION '지급 계좌를 볼 권한이 없어요';
  END IF;
  RETURN QUERY SELECT s.staff_id,b.bank_name,
    extensions.pgp_sym_decrypt(b.account_number_encrypted,public.bank_encryption_key()),
    b.account_number_last4,b.account_holder_name,s.shared_at
  FROM public.gig_bank_account_shares s
  JOIN public.facility_staff fs ON fs.id=s.staff_id AND fs.facility_id=s.facility_id AND fs.worker_id=s.worker_id
  JOIN public.worker_bank_accounts b ON b.id=s.bank_account_id AND b.worker_id=s.worker_id AND b.is_primary AND b.deleted_at IS NULL
  WHERE s.facility_id=p_facility_id AND public.facility_worker_demo_scope_matches(s.facility_id,s.worker_id)
  ORDER BY s.shared_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_gig_shared_bank_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gig_shared_bank_accounts(uuid) TO authenticated;
