-- 근무 대타 요청 (Homebase "Shift Trade" 참고)
--
-- 확정된 워커가 못 나오게 됐을 때 앱 안에 출구가 없었다.
-- cancel_my_shift_application 은 'applied' 만 취소하므로, 확정자는 사업장에 전화하거나 노쇼하는 수밖에 없었다.
-- 이 마이그레이션은 그 출구를 만든다.
--   1) 확정 워커가 대타를 요청한다                            request_shift_cover
--   2) 같은 사업장 인력풀·재직 직원 중 같은 직군이 맡겠다고 한다     claim_shift_cover
--   3) 사업장이 승인하면 확정자가 바뀐다                        approve_shift_cover / reject_shift_cover_claim
--
-- 원칙
--   · 채용 결정은 끝까지 사업장이 한다(직업정보제공). 승인 전까지 그 근무는 원래 워커 몫이다.
--   · 요청 사유는 사업장만 본다. 병가 같은 사적인 사유가 동료에게 노출되지 않게 한다.
--   · 테이블 직접 접근은 막고 RPC로만 다룬다. 사업장 화면은 서버(service role)에서 읽는다.

CREATE TABLE IF NOT EXISTS public.shift_cover_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  requester_application_id uuid NOT NULL REFERENCES public.shift_applications(id) ON DELETE CASCADE,
  requester_worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','claimed','approved','cancelled','expired')),
  claimer_worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  new_application_id uuid REFERENCES public.shift_applications(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_cover_requests_claimer_required
    CHECK (status NOT IN ('claimed','approved') OR claimer_worker_id IS NOT NULL)
);

COMMENT ON TABLE public.shift_cover_requests IS '확정 워커의 대타 요청. 사업장 승인 시 확정자가 교체된다';

-- 한 근무에 진행 중인 대타 요청은 하나만
CREATE UNIQUE INDEX IF NOT EXISTS shift_cover_requests_one_active
  ON public.shift_cover_requests (shift_id) WHERE status IN ('open','claimed');
CREATE INDEX IF NOT EXISTS shift_cover_requests_facility_status
  ON public.shift_cover_requests (facility_id, status);
CREATE INDEX IF NOT EXISTS shift_cover_requests_requester
  ON public.shift_cover_requests (requester_worker_id, created_at DESC);

ALTER TABLE public.shift_cover_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_cover_requests FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 대타 교체 중에는 '반복근무 초대 시프트 자동 취소' 트리거를 건너뛴다.
-- 원래 워커의 확정을 cancelled 로 바꾸는 순간 이 트리거가 시프트 자체를 취소해
-- 대타를 확정할 시프트가 사라지기 때문이다. 플래그는 트랜잭션 한정(set_config ..., true).
-- 함수를 통째로 다시 쓰지 않고, 현재 DB에 있는 본문 맨 앞에 가드만 끼워 넣는다
-- (이 레포의 런타임 패치 방식). 파일과 운영 본문이 달라도 운영 쪽 로직을 보존한다. 재실행해도 안전하다.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  def text;
  patched text;
BEGIN
  SELECT pg_get_functiondef('public.close_cancelled_invited_shift()'::regprocedure) INTO def;
  IF strpos(def, 'app.cover_swap') > 0 THEN
    RETURN;
  END IF;
  -- 첫 번째 BEGIN(= 함수 본문 시작) 바로 뒤에만 넣는다
  patched := regexp_replace(
    def, '\mBEGIN\M',
    E'BEGIN\n  IF current_setting(''app.cover_swap'', true) = ''on'' THEN\n    RETURN NEW;\n  END IF;'
  );
  IF patched = def THEN
    RAISE EXCEPTION 'close_cancelled_invited_shift cover_swap guard patch failed';
  END IF;
  EXECUTE patched;
END $$;

-- ---------------------------------------------------------------------------
-- 내부 헬퍼
-- ---------------------------------------------------------------------------

-- 이 사업장에서 면허·자격이 확인된 적 있는가. 확인 방법을 돌려주고, 없으면 NULL.
-- 간호사·간호조무사·약사는 플랫폼 'approved'가 아니라 사업장이 원본을 확인하는 단계적 검증이다
-- (20260818 progressive_credential). 대타 확정도 같은 근거가 있어야 한다.
--   · 이 사업장의 이전 확정에서 facility_confirmed 된 기록 → 그때의 확인 방법을 이어받는다
--   · 재직 직원 → 사업장 인사 절차로 확인된 것으로 본다(internal_hr_process)
CREATE OR REPLACE FUNCTION public.prior_facility_credential(p_worker_id uuid, p_facility_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(a.credential_verification_method, 'internal_hr_process')
       FROM public.shift_applications a
       JOIN public.shifts s ON s.id = a.shift_id
      WHERE a.worker_id = p_worker_id
        AND s.facility_id = p_facility_id
        AND a.credential_review_status = 'facility_confirmed'
      ORDER BY a.credential_confirmed_at DESC NULLS LAST
      LIMIT 1),
    (SELECT 'internal_hr_process'
       FROM public.facility_staff fs
      WHERE fs.facility_id = p_facility_id AND fs.worker_id = p_worker_id AND fs.status = 'active'
      LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION public.prior_facility_credential(uuid, uuid) FROM PUBLIC;

-- 대타를 맡을 수 있는 사람: 그 사업장 인력풀(active) 또는 재직 직원 중 같은 직군이고,
-- 플랫폼 승인 워커이거나 이 사업장에서 자격이 확인된 적 있는 단계적 검증 직군.
-- 인력풀에 수동으로만 추가되고 확인 기록이 없는 사람은 제외한다 — 사업장이 승인할 수 없는 신청을 막는다.
CREATE OR REPLACE FUNCTION public.can_cover_shift(p_worker_id uuid, p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shifts s
    JOIN public.workers w ON w.id = p_worker_id
    WHERE s.id = p_shift_id
      AND w.deleted_at IS NULL
      AND (s.required_role IS NULL OR s.required_role = 'any' OR w.role = s.required_role)
      AND (
        EXISTS (SELECT 1 FROM public.facility_worker_pool p
                WHERE p.facility_id = s.facility_id AND p.worker_id = w.id AND p.status = 'active')
        OR EXISTS (SELECT 1 FROM public.facility_staff fs
                   WHERE fs.facility_id = s.facility_id AND fs.worker_id = w.id AND fs.status = 'active')
      )
      AND (
        w.verification_status = 'approved'
        OR (w.role IN ('rn','na','pharmacist')
            AND public.prior_facility_credential(w.id, s.facility_id) IS NOT NULL)
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_cover_shift(uuid, uuid) FROM PUBLIC;

-- 같은 시간대에 이미 확정된 다른 근무가 있는가 (accept_shift_application 과 같은 기준)
CREATE OR REPLACE FUNCTION public.has_overlapping_accepted_shift(p_worker_id uuid, p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH target AS (
    SELECT s.shift_date + s.start_time AS starts_at,
           s.shift_date + s.end_time
             + CASE WHEN s.is_overnight THEN interval '1 day' ELSE interval '0 day' END AS ends_at
    FROM public.shifts s WHERE s.id = p_shift_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.shift_applications a
    JOIN public.shifts o ON o.id = a.shift_id
    CROSS JOIN target t
    WHERE a.worker_id = p_worker_id
      AND a.status = 'accepted'
      AND a.shift_id <> p_shift_id
      AND (o.shift_date + o.start_time) < t.ends_at
      AND (o.shift_date + o.end_time
           + CASE WHEN o.is_overnight THEN interval '1 day' ELSE interval '0 day' END) > t.starts_at
  );
$$;
REVOKE ALL ON FUNCTION public.has_overlapping_accepted_shift(uuid, uuid) FROM PUBLIC;

-- 사업장 알림 수신자 (enqueue_admin_new_application 과 같은 기준)
CREATE OR REPLACE FUNCTION public.facility_notification_recipients(p_facility_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.admin_user_id FROM public.facilities f
  WHERE f.id = p_facility_id AND f.admin_user_id IS NOT NULL
  UNION
  SELECT fa.user_id FROM public.facility_admin_access fa
  WHERE fa.facility_id = p_facility_id AND fa.access_role IN ('operator','super');
$$;
REVOKE ALL ON FUNCTION public.facility_notification_recipients(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 1) 확정 워커 → 대타 요청
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_shift_cover(p_application_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_app public.shift_applications%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_requester_name text;
  v_request_id uuid;
  v_label text;
  v_recipient uuid;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;

  SELECT * INTO v_app FROM public.shift_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.worker_id <> v_worker_id OR v_app.status <> 'accepted' THEN
    RAISE EXCEPTION '확정된 내 근무만 대타를 요청할 수 있어요';
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = v_app.shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'matched' THEN
    RAISE EXCEPTION '이미 시작했거나 종료된 근무예요';
  END IF;
  IF (v_shift.shift_date + v_shift.start_time) <= timezone('Asia/Seoul', now()) THEN
    RAISE EXCEPTION '이미 시작한 근무는 대타를 요청할 수 없어요';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_cover_requests
             WHERE shift_id = v_shift.id AND status IN ('open','claimed')) THEN
    RAISE EXCEPTION '이 근무는 이미 대타를 구하고 있어요';
  END IF;

  INSERT INTO public.shift_cover_requests (shift_id, facility_id, requester_application_id, requester_worker_id, reason)
  VALUES (v_shift.id, v_shift.facility_id, v_app.id, v_worker_id, NULLIF(btrim(COALESCE(p_reason, '')), ''))
  RETURNING id INTO v_request_id;

  SELECT name INTO v_requester_name FROM public.workers WHERE id = v_worker_id;
  v_label := to_char(v_shift.shift_date, 'FMMM월 FMDD일') || ' ' || to_char(v_shift.start_time, 'HH24:MI');

  -- 맡을 수 있는 사람에게만 알린다(can_cover_shift 와 같은 기준). 사유는 보내지 않는다.
  -- 후보를 그 사업장 인력풀·직원으로 먼저 좁힌 뒤 자격을 본다.
  FOR v_recipient IN
    WITH candidates AS (
      SELECT p.worker_id FROM public.facility_worker_pool p
      WHERE p.facility_id = v_shift.facility_id AND p.status = 'active'
      UNION
      SELECT fs.worker_id FROM public.facility_staff fs
      WHERE fs.facility_id = v_shift.facility_id AND fs.status = 'active' AND fs.worker_id IS NOT NULL
    )
    SELECT DISTINCT w.auth_user_id
    FROM candidates c
    JOIN public.workers w ON w.id = c.worker_id
    WHERE w.id <> v_worker_id
      AND w.auth_user_id IS NOT NULL
      AND public.can_cover_shift(w.id, v_shift.id)
    LIMIT 100
  LOOP
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (
      v_recipient, 'shift.cover_requested',
      'shift.cover_requested:' || v_request_id::text || ':' || v_recipient::text,
      '함께 일한 곳에서 대타를 구해요',
      format('%s 근무 · 맡아주시면 사업장 승인 후 확정돼요', v_label),
      jsonb_build_object('url','/cover','coverRequestId',v_request_id,'shiftId',v_shift.id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  FOR v_recipient IN SELECT public.facility_notification_recipients(v_shift.facility_id) LOOP
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (
      v_recipient, 'shift.cover_requested.admin',
      'shift.cover_requested.admin:' || v_request_id::text || ':' || v_recipient::text,
      '대타 요청이 들어왔어요',
      format('%s님이 %s 근무 대타를 구하고 있어요. 누군가 맡으면 승인 요청이 와요.', COALESCE(v_requester_name, '워커'), v_label),
      jsonb_build_object('url','/applications#cover','coverRequestId',v_request_id,'shiftId',v_shift.id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('worker', auth.uid(), 'shift_cover.request', 'shift_cover_request', v_request_id,
          jsonb_build_object('shift_id', v_shift.id, 'application_id', v_app.id));

  RETURN v_request_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) 요청한 워커 → 취소 (아직 승인 전일 때만)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_shift_cover(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_req public.shift_cover_requests%ROWTYPE;
  v_claimer_auth uuid;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;

  SELECT * INTO v_req FROM public.shift_cover_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.requester_worker_id <> v_worker_id OR v_req.status NOT IN ('open','claimed') THEN
    RAISE EXCEPTION '취소할 수 있는 대타 요청이 아니에요';
  END IF;

  UPDATE public.shift_cover_requests
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_req.id;

  IF v_req.status = 'claimed' THEN
    SELECT auth_user_id INTO v_claimer_auth FROM public.workers WHERE id = v_req.claimer_worker_id;
    IF v_claimer_auth IS NOT NULL THEN
      INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
      VALUES (
        v_claimer_auth, 'shift.cover_cancelled',
        'shift.cover_cancelled:' || v_req.id::text,
        '대타 요청이 취소됐어요',
        '원래 근무자가 나오기로 했어요. 맡아주려고 해주셔서 고마워요.',
        jsonb_build_object('url','/cover','coverRequestId',v_req.id)
      ) ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('worker', auth.uid(), 'shift_cover.cancel', 'shift_cover_request', v_req.id,
          jsonb_build_object('previous_status', v_req.status));
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) 동료·인력풀 워커 → 맡겠다고 함 (선착순 1명, 사업장 승인 대기)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_shift_cover(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_req public.shift_cover_requests%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_claimer_name text;
  v_requester public.workers%ROWTYPE;
  v_label text;
  v_recipient uuid;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;

  SELECT * INTO v_req FROM public.shift_cover_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.status <> 'open' THEN
    RAISE EXCEPTION '이미 다른 분이 맡았거나 마감된 요청이에요';
  END IF;
  IF v_req.requester_worker_id = v_worker_id THEN
    RAISE EXCEPTION '내가 올린 요청은 맡을 수 없어요';
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = v_req.shift_id;
  IF NOT FOUND OR v_shift.status <> 'matched'
     OR (v_shift.shift_date + v_shift.start_time) <= timezone('Asia/Seoul', now()) THEN
    RAISE EXCEPTION '이미 시작했거나 종료된 근무예요';
  END IF;
  IF NOT public.can_cover_shift(v_worker_id, v_shift.id) THEN
    RAISE EXCEPTION '이 사업장에서 함께 일한 같은 직군만 맡을 수 있어요';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_worker_id::text, 1));
  IF public.has_overlapping_accepted_shift(v_worker_id, v_shift.id) THEN
    RAISE EXCEPTION '같은 시간에 이미 확정된 근무가 있어요';
  END IF;

  UPDATE public.shift_cover_requests
  SET status = 'claimed', claimer_worker_id = v_worker_id, claimed_at = now(), updated_at = now()
  WHERE id = v_req.id;

  SELECT name INTO v_claimer_name FROM public.workers WHERE id = v_worker_id;
  SELECT * INTO v_requester FROM public.workers WHERE id = v_req.requester_worker_id;
  v_label := to_char(v_shift.shift_date, 'FMMM월 FMDD일') || ' ' || to_char(v_shift.start_time, 'HH24:MI');

  FOR v_recipient IN SELECT public.facility_notification_recipients(v_shift.facility_id) LOOP
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (
      v_recipient, 'shift.cover_claimed.admin',
      'shift.cover_claimed.admin:' || v_req.id::text || ':' || v_worker_id::text || ':' || v_recipient::text,
      '대타 승인이 필요해요',
      format('%s님 %s 근무를 %s님이 맡겠다고 했어요.', COALESCE(v_requester.name, '워커'), v_label, COALESCE(v_claimer_name, '워커')),
      jsonb_build_object('url','/applications#cover','coverRequestId',v_req.id,'shiftId',v_shift.id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  IF v_requester.auth_user_id IS NOT NULL THEN
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (
      v_requester.auth_user_id, 'shift.cover_claimed',
      'shift.cover_claimed:' || v_req.id::text || ':' || v_worker_id::text,
      format('%s님이 대타를 맡겠다고 했어요', COALESCE(v_claimer_name, '동료')),
      format('%s 근무 · 사업장이 승인하면 확정돼요. 승인 전까지는 내 근무예요.', v_label),
      jsonb_build_object('url','/applications','coverRequestId',v_req.id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('worker', auth.uid(), 'shift_cover.claim', 'shift_cover_request', v_req.id,
          jsonb_build_object('claimer_worker_id', v_worker_id));
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) 사업장 → 승인: 원래 워커 확정을 내리고 대타를 확정한다 (한 트랜잭션)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_shift_cover(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req public.shift_cover_requests%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_requester_app public.shift_applications%ROWTYPE;
  v_claimer public.workers%ROWTYPE;
  v_requester public.workers%ROWTYPE;
  v_new_app_id uuid;
  v_label text;
  v_platform boolean;
  v_method text;
BEGIN
  SELECT * INTO v_req FROM public.shift_cover_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.status <> 'claimed' THEN
    RAISE EXCEPTION '승인할 수 있는 대타 요청이 아니에요';
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = v_req.shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '근무를 찾을 수 없어요'; END IF;
  IF NOT public.can_manage_facility(v_shift.facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '대타를 승인할 권한이 없어요';
  END IF;
  IF v_shift.status <> 'matched'
     OR (v_shift.shift_date + v_shift.start_time) <= timezone('Asia/Seoul', now()) THEN
    RAISE EXCEPTION '이미 시작했거나 종료된 근무예요';
  END IF;

  SELECT * INTO v_requester_app FROM public.shift_applications WHERE id = v_req.requester_application_id FOR UPDATE;
  IF NOT FOUND OR v_requester_app.status <> 'accepted' THEN
    RAISE EXCEPTION '원래 근무자의 확정 상태가 바뀌어 승인할 수 없어요';
  END IF;

  SELECT * INTO v_claimer FROM public.workers WHERE id = v_req.claimer_worker_id;
  IF NOT FOUND OR NOT public.can_cover_shift(v_claimer.id, v_shift.id) THEN
    RAISE EXCEPTION '대타를 맡기로 한 분이 더 이상 조건에 맞지 않아요';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_claimer.id::text, 1));
  IF public.has_overlapping_accepted_shift(v_claimer.id, v_shift.id) THEN
    RAISE EXCEPTION '대타를 맡기로 한 분에게 같은 시간 확정 근무가 생겼어요';
  END IF;

  -- 자격 근거: accept_shift_application 과 같은 규칙. 플랫폼 승인이면 platform_verified,
  -- 단계적 검증 직군이면 이 사업장의 이전 확인 기록을 이어받아 facility_confirmed (승인자가 확인자).
  v_platform := v_claimer.verification_status = 'approved';
  IF NOT v_platform THEN
    v_method := public.prior_facility_credential(v_claimer.id, v_shift.facility_id);
    IF v_method IS NULL THEN
      RAISE EXCEPTION '이 분은 이 사업장에서 면허·자격을 확인한 기록이 없어요. 지원자 화면에서 원본 확인 후 진행해 주세요';
    END IF;
  END IF;

  -- 시프트당 확정자는 1명(부분 유니크 인덱스)이므로 원래 워커를 먼저 내린다
  PERFORM set_config('app.cover_swap', 'on', true);
  UPDATE public.shift_applications
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = v_requester_app.id;

  INSERT INTO public.shift_applications (
    shift_id, worker_id, status, responded_at,
    credential_review_status, credential_confirmed_by, credential_confirmed_at, credential_verification_method
  ) VALUES (
    v_shift.id, v_claimer.id, 'accepted', now(),
    CASE WHEN v_platform THEN 'platform_verified' ELSE 'facility_confirmed' END,
    CASE WHEN v_platform THEN NULL ELSE auth.uid() END,
    CASE WHEN v_platform THEN NULL ELSE now() END,
    v_method
  )
  ON CONFLICT (shift_id, worker_id) DO UPDATE
    SET status = 'accepted', responded_at = now(), cancelled_at = NULL,
        credential_review_status = EXCLUDED.credential_review_status,
        credential_confirmed_by = EXCLUDED.credential_confirmed_by,
        credential_confirmed_at = EXCLUDED.credential_confirmed_at,
        credential_verification_method = EXCLUDED.credential_verification_method
  RETURNING id INTO v_new_app_id;
  PERFORM set_config('app.cover_swap', 'off', true);

  UPDATE public.shifts
  SET matched_worker_id = v_claimer.id, matched_at = now(), updated_at = now()
  WHERE id = v_shift.id;

  UPDATE public.shift_cover_requests
  SET status = 'approved', new_application_id = v_new_app_id,
      decided_at = now(), decided_by = auth.uid(), updated_at = now()
  WHERE id = v_req.id;

  SELECT * INTO v_requester FROM public.workers WHERE id = v_req.requester_worker_id;
  v_label := to_char(v_shift.shift_date, 'FMMM월 FMDD일') || ' '
          || to_char(v_shift.start_time, 'HH24:MI') || '~' || to_char(v_shift.end_time, 'HH24:MI');

  IF v_claimer.auth_user_id IS NOT NULL THEN
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (
      v_claimer.auth_user_id, 'shift.accepted',
      'shift.accepted:' || v_new_app_id::text,
      '🎉 대타 근무가 확정됐어요',
      format('%s · ₩%s', v_label, to_char(v_shift.estimated_total_pay, 'FM999,999,999')),
      jsonb_build_object('type','accepted','applicationId',v_new_app_id,'shiftId',v_shift.id,'url','/applications')
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  IF v_requester.auth_user_id IS NOT NULL THEN
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (
      v_requester.auth_user_id, 'shift.cover_approved',
      'shift.cover_approved:' || v_req.id::text,
      '대타가 확정됐어요',
      format('%s 근무는 %s님이 맡아요. 이 근무는 빠지셔도 돼요.', v_label, COALESCE(v_claimer.name, '동료')),
      jsonb_build_object('url','/applications','coverRequestId',v_req.id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('admin', auth.uid(), 'shift_cover.approve', 'shift_cover_request', v_req.id,
          jsonb_build_object('shift_id', v_shift.id,
                             'from_application_id', v_requester_app.id,
                             'to_application_id', v_new_app_id,
                             'to_worker_id', v_claimer.id));
  RETURN v_new_app_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) 사업장 → 이 사람은 아님: 요청은 다시 열리고 다른 사람이 맡을 수 있다
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_shift_cover_claim(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_req public.shift_cover_requests%ROWTYPE;
  v_facility_id uuid;
  v_claimer_auth uuid;
BEGIN
  SELECT * INTO v_req FROM public.shift_cover_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.status <> 'claimed' THEN
    RAISE EXCEPTION '처리할 수 있는 대타 요청이 아니에요';
  END IF;
  SELECT facility_id INTO v_facility_id FROM public.shifts WHERE id = v_req.shift_id;
  IF NOT public.can_manage_facility(v_facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '대타 요청을 처리할 권한이 없어요';
  END IF;

  UPDATE public.shift_cover_requests
  SET status = 'open', claimer_worker_id = NULL, claimed_at = NULL, updated_at = now()
  WHERE id = v_req.id;

  SELECT auth_user_id INTO v_claimer_auth FROM public.workers WHERE id = v_req.claimer_worker_id;
  IF v_claimer_auth IS NOT NULL THEN
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (
      v_claimer_auth, 'shift.cover_claim_rejected',
      'shift.cover_claim_rejected:' || v_req.id::text || ':' || v_req.claimer_worker_id::text,
      '이번 대타는 다른 분과 진행해요',
      '사업장이 이번엔 다른 방법으로 인력을 맞추기로 했어요. 맡아주려고 해주셔서 고마워요.',
      jsonb_build_object('url','/cover','coverRequestId',v_req.id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('admin', auth.uid(), 'shift_cover.reject_claim', 'shift_cover_request', v_req.id,
          jsonb_build_object('claimer_worker_id', v_req.claimer_worker_id));
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 워커 화면용 읽기 RPC
-- ---------------------------------------------------------------------------

-- 내가 올린 대타 요청 (진행 중 + 최근 7일 결정분)
CREATE OR REPLACE FUNCTION public.list_my_shift_covers()
RETURNS TABLE (
  id uuid, status text, application_id uuid, shift_id uuid,
  shift_date date, start_time time, end_time time,
  facility_name text, claimer_name text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.status, r.requester_application_id, r.shift_id,
         s.shift_date, s.start_time, s.end_time,
         f.name, c.name, r.created_at
  FROM public.shift_cover_requests r
  JOIN public.shifts s ON s.id = r.shift_id
  JOIN public.facilities f ON f.id = r.facility_id
  LEFT JOIN public.workers c ON c.id = r.claimer_worker_id
  WHERE r.requester_worker_id = public.current_worker_id()
    AND (r.status IN ('open','claimed') OR r.updated_at > now() - interval '7 days')
  ORDER BY s.shift_date, s.start_time;
$$;

-- 내가 맡을 수 있는 대타 요청 (사유·요청자 이름은 내려주지 않는다)
CREATE OR REPLACE FUNCTION public.list_claimable_shift_covers()
RETURNS TABLE (
  id uuid, shift_id uuid, shift_date date, start_time time, end_time time, is_overnight boolean,
  facility_name text, department text, required_role text,
  hourly_wage integer, estimated_total_pay integer, claimed_by_me boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, s.id, s.shift_date, s.start_time, s.end_time, s.is_overnight,
         f.name, s.department, s.required_role,
         s.hourly_wage::integer, s.estimated_total_pay::integer,
         (r.status = 'claimed') AS claimed_by_me
  FROM public.shift_cover_requests r
  JOIN public.shifts s ON s.id = r.shift_id
  JOIN public.facilities f ON f.id = r.facility_id
  WHERE r.requester_worker_id <> public.current_worker_id()
    AND (
      (r.status = 'open' AND public.can_cover_shift(public.current_worker_id(), s.id))
      OR (r.status = 'claimed' AND r.claimer_worker_id = public.current_worker_id())
    )
    AND s.status = 'matched'
    AND (s.shift_date + s.start_time) > timezone('Asia/Seoul', now())
  ORDER BY s.shift_date, s.start_time;
$$;

REVOKE ALL ON FUNCTION public.request_shift_cover(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_shift_cover(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_shift_cover(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_shift_cover(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_shift_cover_claim(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_shift_covers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_claimable_shift_covers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_shift_cover(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shift_cover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_shift_cover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_shift_cover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_shift_cover_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_shift_covers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_claimable_shift_covers() TO authenticated;
