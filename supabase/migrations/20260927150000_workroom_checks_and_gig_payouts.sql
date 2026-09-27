-- 1) 워크룸 출석 확인: 관리자가 "내일 10시 출근 확인해 주세요"를 올리면 근무자가 버튼 하나로 답한다 (당근 단기알바 단체톡의 출석체크 대체)
-- 2) 긱워커 지급: 근무가 끝나면 하루든 일주일이든 묶어서 '지금 지급' 또는 '나중에(날짜) 지급'으로 기록하고 워커가 앱에서 본다

-- ── 워크룸 구성원 판정 ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_workroom_member(p_facility_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.facility_access_role(p_facility_id) IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.facility_staff fs
      WHERE fs.facility_id = p_facility_id AND fs.worker_id = public.current_worker_id() AND fs.status <> 'ended'
    );
$$;
REVOKE ALL ON FUNCTION public.is_workroom_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workroom_member(uuid) TO authenticated;

-- ── 출석 확인 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.facility_workroom_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.facility_workroom_messages(id) ON DELETE SET NULL,
  body text NOT NULL,
  due_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workroom_checks_facility ON public.facility_workroom_checks(facility_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.facility_workroom_check_replies (
  check_id uuid NOT NULL REFERENCES public.facility_workroom_checks(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  replied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (check_id, staff_id)
);

ALTER TABLE public.facility_workroom_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_workroom_check_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workroom_checks_member_read ON public.facility_workroom_checks;
CREATE POLICY workroom_checks_member_read ON public.facility_workroom_checks FOR SELECT
  USING (public.is_workroom_member(facility_id));
DROP POLICY IF EXISTS workroom_check_replies_member_read ON public.facility_workroom_check_replies;
CREATE POLICY workroom_check_replies_member_read ON public.facility_workroom_check_replies FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.facility_workroom_checks c WHERE c.id = check_id AND public.is_workroom_member(c.facility_id)));
REVOKE ALL ON public.facility_workroom_checks, public.facility_workroom_check_replies FROM anon, authenticated;
GRANT SELECT ON public.facility_workroom_checks, public.facility_workroom_check_replies TO authenticated;

DO $rt$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.facility_workroom_check_replies;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $rt$;

-- 관리자가 출석 확인을 올린다: 공지 메시지 + 확인 레코드 + 근무자 푸시
CREATE OR REPLACE FUNCTION public.create_workroom_check(p_facility_id uuid, p_body text, p_due_at timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_facility public.facilities%ROWTYPE;
  v_user auth.users%ROWTYPE;
  v_name text;
  v_body text;
  v_message public.facility_workroom_messages%ROWTYPE;
  v_check_id uuid;
  v_recipient uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF public.facility_access_role(p_facility_id) IS NULL THEN RAISE EXCEPTION '출석 확인은 관리자만 올릴 수 있어요'; END IF;
  SELECT * INTO v_facility FROM public.facilities WHERE id = p_facility_id AND is_active = true AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '워크룸을 찾을 수 없어요'; END IF;
  v_body := trim(COALESCE(p_body, ''));
  IF char_length(v_body) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '출석 확인 내용은 1~500자로 입력해 주세요'; END IF;
  SELECT * INTO v_user FROM auth.users WHERE id = auth.uid();
  v_name := COALESCE(NULLIF(v_user.raw_user_meta_data->>'name',''), NULLIF(v_user.raw_user_meta_data->>'nickname',''), NULLIF(v_facility.contact_name,''), '관리자');

  v_check_id := gen_random_uuid();
  INSERT INTO public.facility_workroom_messages(facility_id, sender_type, sender_user_id, sender_name, message_type, body, metadata)
  VALUES (p_facility_id, 'admin', auth.uid(), v_name, 'announcement', v_body,
    jsonb_build_object('kind','check','checkId',v_check_id,'dueAt',p_due_at))
  RETURNING * INTO v_message;
  INSERT INTO public.facility_workroom_checks(id, facility_id, message_id, body, due_at, created_by)
  VALUES (v_check_id, p_facility_id, v_message.id, v_body, p_due_at, auth.uid());

  FOR v_recipient IN
    SELECT w.auth_user_id FROM public.facility_staff fs
    JOIN public.workers w ON w.id = fs.worker_id
    WHERE fs.facility_id = p_facility_id AND fs.status <> 'ended' AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL
  LOOP
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (v_recipient, 'workroom.check', 'workroom.check:' || v_check_id::text || ':' || v_recipient::text,
      v_facility.name || ' 출석 확인', left(v_body, 80) || ' — 앱에서 확인 버튼을 눌러 주세요',
      jsonb_build_object('url', '/workroom?facility=' || p_facility_id::text, 'kind', 'workroom.check', 'facilityId', p_facility_id, 'checkId', v_check_id))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
  RETURN v_check_id;
END;
$$;

-- 근무자가 확인 버튼을 누른다
CREATE OR REPLACE FUNCTION public.reply_workroom_check(p_check_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_check public.facility_workroom_checks%ROWTYPE;
  v_staff public.facility_staff%ROWTYPE;
  v_worker_id uuid := public.current_worker_id();
BEGIN
  IF auth.uid() IS NULL OR v_worker_id IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  SELECT * INTO v_check FROM public.facility_workroom_checks WHERE id = p_check_id;
  IF NOT FOUND THEN RAISE EXCEPTION '출석 확인을 찾을 수 없어요'; END IF;
  SELECT * INTO v_staff FROM public.facility_staff
  WHERE facility_id = v_check.facility_id AND worker_id = v_worker_id AND status <> 'ended'
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION '이 워크룸의 근무자만 확인할 수 있어요'; END IF;
  INSERT INTO public.facility_workroom_check_replies(check_id, staff_id, worker_id)
  VALUES (p_check_id, v_staff.id, v_worker_id)
  ON CONFLICT (check_id, staff_id) DO NOTHING;
END;
$$;

-- 관리자·근무자 공용: 확인별 근무자 응답 현황 (연결된 근무자만)
CREATE OR REPLACE FUNCTION public.get_workroom_check_status(p_facility_id uuid)
RETURNS TABLE(check_id uuid, staff_id uuid, staff_name text, replied_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT c.id, fs.id, fs.name, r.replied_at
  FROM public.facility_workroom_checks c
  JOIN public.facility_staff fs ON fs.facility_id = c.facility_id AND fs.status <> 'ended' AND fs.worker_id IS NOT NULL
  LEFT JOIN public.facility_workroom_check_replies r ON r.check_id = c.id AND r.staff_id = fs.id
  WHERE c.facility_id = p_facility_id AND public.is_workroom_member(p_facility_id)
  ORDER BY c.created_at DESC, fs.name;
$$;

REVOKE ALL ON FUNCTION public.create_workroom_check(uuid,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reply_workroom_check(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_workroom_check_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workroom_check(uuid,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reply_workroom_check(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workroom_check_status(uuid) TO authenticated;

-- ── 긱워커 지급 ──────────────────────────────────────────────────────────────
-- 월 단위 staff_wage_payments 와 달리 기간을 자유롭게 묶는다(하루·일주일). 관리자 앱이 서비스 키로 쓰고, 근무자는 자기 것만 읽는다.
CREATE TABLE IF NOT EXISTS public.gig_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  worked_days integer NOT NULL DEFAULT 0 CHECK (worked_days >= 0),
  pay_basis text NOT NULL CHECK (pay_basis IN ('hourly','daily','monthly')),
  pay_rate integer NOT NULL CHECK (pay_rate > 0),
  amount integer NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','paid','cancelled')),
  pay_at date,
  paid_at timestamptz,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gig_payouts_staff ON public.gig_payouts(staff_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_gig_payouts_facility ON public.gig_payouts(facility_id, status);

ALTER TABLE public.gig_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gig_payouts_admin_read ON public.gig_payouts;
CREATE POLICY gig_payouts_admin_read ON public.gig_payouts FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS gig_payouts_worker_read ON public.gig_payouts;
CREATE POLICY gig_payouts_worker_read ON public.gig_payouts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.facility_staff fs WHERE fs.id = staff_id AND fs.worker_id = public.current_worker_id()));
REVOKE ALL ON public.gig_payouts FROM anon, authenticated;
GRANT SELECT ON public.gig_payouts TO authenticated;
