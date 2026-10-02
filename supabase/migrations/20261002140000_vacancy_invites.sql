-- 결원 채우기 — 우리 직원 + 함께 일한 근무자에게 한 번에 요청, 먼저 수락한 사람으로 바로 확정
--
-- 결원(직원 미출근·휴가, 확정 근무자 노쇼, 미충원 공고, 필요 인원 부족)이 생기면 사업장이 요청할 사람을
-- 직접 고른다. 고른 사람들에게 알림이 가고, 가장 먼저 수락한 사람으로 근무가 확정되며 나머지 요청은 닫힌다.
-- 채용 결정(누구에게 맡길지)은 사업장이 사람을 고르는 순간 내린 것이고, 잇닿은 고르거나 추천하지 않는다.
--
-- 기존 반복근무 요청(audience='invited', 1명 지정)은 그대로 두고 — 수락 후 사업장이 한 번 더 확정 —
-- 결원 요청은 새 공개 범위 'targeted'(요청받은 사람만 보는 근무) 또는 공개 공고에 붙는 요청으로 만든다.
-- 요청받을 수 있는 사람: 그 사업장의 재직 직원(앱 연결) 또는 인력풀 근무자 중 같은 직군이고,
-- 플랫폼 승인이거나 이 사업장에서 자격을 확인한 기록이 있는 사람 (대타와 같은 기준). 데모·실제는 서로 섞이지 않는다.

-- 1) 컬럼 ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.shift_applications
  ADD COLUMN IF NOT EXISTS confirm_on_accept boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.shift_applications.confirm_on_accept IS '결원 요청: 근무자가 수락하면 사업장 추가 확정 없이 바로 확정(먼저 수락한 1명)';

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_audience_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_audience_check CHECK (audience IN ('public','invited','targeted'));
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_invited_audience_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_invited_audience_check CHECK (
  (audience IN ('public','targeted') AND invited_worker_id IS NULL)
  OR (audience = 'invited' AND invited_worker_id IS NOT NULL)
);

-- 2) 요청 가능 여부 — NULL 이면 요청할 수 있고, 아니면 화면에 보여 줄 이유 ───────────────
CREATE OR REPLACE FUNCTION public.vacancy_block_reason(
  p_worker_id uuid, p_facility_id uuid, p_date date, p_start time, p_end time, p_role text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_staff public.facility_staff%ROWTYPE;
  v_is_staff boolean;
  v_in_pool boolean;
  v_from timestamp := p_date + p_start;
  v_to timestamp := p_date + p_end + CASE WHEN p_end <= p_start THEN interval '1 day' ELSE interval '0 day' END;
  v_weekday smallint := extract(isodow FROM p_date)::smallint;
  v_staff_from timestamp;
  v_staff_to timestamp;
BEGIN
  SELECT * INTO v_worker FROM public.workers WHERE id = p_worker_id;
  IF NOT FOUND OR v_worker.deleted_at IS NOT NULL THEN RETURN '탈퇴한 계정'; END IF;
  SELECT * INTO v_facility FROM public.facilities WHERE id = p_facility_id;
  IF NOT FOUND OR COALESCE(v_facility.is_demo, false) <> COALESCE(v_worker.is_demo, false) THEN RETURN '요청 대상이 아니에요'; END IF;
  IF p_role IS NOT NULL AND p_role <> 'any' AND v_worker.role <> p_role THEN RETURN '직군이 달라요'; END IF;

  SELECT * INTO v_staff FROM public.facility_staff
  WHERE facility_id = p_facility_id AND worker_id = p_worker_id AND status = 'active'
    AND (contract_start IS NULL OR contract_start <= p_date)
    AND (contract_end IS NULL OR contract_end >= p_date)
  LIMIT 1;
  v_is_staff := FOUND;
  v_in_pool := EXISTS (SELECT 1 FROM public.facility_worker_pool
                       WHERE facility_id = p_facility_id AND worker_id = p_worker_id AND status = 'active');
  IF NOT v_is_staff AND NOT v_in_pool THEN RETURN '함께 일한 기록이 없어요'; END IF;

  IF NOT (v_worker.verification_status = 'approved'
          OR (v_worker.role IN ('rn','na','pharmacist')
              AND public.prior_facility_credential(p_worker_id, p_facility_id) IS NOT NULL)) THEN
    RETURN '자격 확인 기록이 없어요';
  END IF;

  IF v_is_staff THEN
    IF EXISTS (SELECT 1 FROM public.staff_leave_requests l
               WHERE l.staff_id = v_staff.id AND l.status = 'approved' AND p_date BETWEEN l.start_date AND l.end_date) THEN
      RETURN '휴가 중';
    END IF;
    -- 자기 근무일·근무시간과 겹치면 이미 근무 중
    IF (v_staff.work_weekdays IS NULL OR cardinality(v_staff.work_weekdays) = 0 OR v_weekday = ANY (v_staff.work_weekdays))
       AND v_staff.default_start_time IS NOT NULL AND v_staff.default_end_time IS NOT NULL THEN
      v_staff_from := p_date + v_staff.default_start_time;
      v_staff_to := p_date + v_staff.default_end_time
        + CASE WHEN v_staff.default_end_time <= v_staff.default_start_time THEN interval '1 day' ELSE interval '0 day' END;
      IF v_staff_from < v_to AND v_staff_to > v_from THEN RETURN '그 시간 근무 중'; END IF;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_applications a
    JOIN public.shifts o ON o.id = a.shift_id
    WHERE a.worker_id = p_worker_id AND a.status = 'accepted'
      AND (o.shift_date + o.start_time) < v_to
      AND (o.shift_date + o.end_time + CASE WHEN o.is_overnight THEN interval '1 day' ELSE interval '0 day' END) > v_from
  ) THEN
    RETURN '같은 시간 확정 근무가 있어요';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.vacancy_block_reason(uuid, uuid, date, time, time, text) FROM PUBLIC, anon, authenticated;

-- 3) 후보 목록 — 재직 직원 먼저, 그다음 인력풀(근무 횟수·최근 순). 고르는 건 사업장 ───────────
CREATE OR REPLACE FUNCTION public.list_vacancy_candidates(
  p_facility_id uuid, p_date date, p_start time, p_end time, p_role text, p_shift_id uuid DEFAULT NULL
)
RETURNS TABLE(kind text, staff_id uuid, worker_id uuid, name text, role text,
              completed_shift_count integer, last_worked_at date, block_reason text, request_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_manage_facility(p_facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '결원을 관리할 권한이 없어요';
  END IF;
  RETURN QUERY
  WITH staff AS (
    SELECT 'staff'::text AS kind, s.id AS staff_id, s.worker_id, COALESCE(w.name, s.name) AS name,
           COALESCE(w.role, s.role) AS role, NULL::integer AS completed_shift_count, NULL::date AS last_worked_at,
           CASE WHEN s.worker_id IS NULL THEN '앱 미연결'
                ELSE public.vacancy_block_reason(s.worker_id, p_facility_id, p_date, p_start, p_end, p_role) END AS block_reason
    FROM public.facility_staff s
    LEFT JOIN public.workers w ON w.id = s.worker_id
    WHERE s.facility_id = p_facility_id AND s.status = 'active'
      AND (s.contract_start IS NULL OR s.contract_start <= p_date)
      AND (s.contract_end IS NULL OR s.contract_end >= p_date)
      AND (p_role IS NULL OR p_role = 'any' OR COALESCE(w.role, s.role) = p_role)
  ), pool AS (
    SELECT 'pool'::text, NULL::uuid, p.worker_id, w.name, w.role, p.completed_shift_count, p.last_worked_at,
           public.vacancy_block_reason(p.worker_id, p_facility_id, p_date, p_start, p_end, p_role)
    FROM public.facility_worker_pool p
    JOIN public.workers w ON w.id = p.worker_id AND w.deleted_at IS NULL
    WHERE p.facility_id = p_facility_id AND p.status = 'active'
      AND (p_role IS NULL OR p_role = 'any' OR w.role = p_role)
      AND NOT EXISTS (SELECT 1 FROM staff WHERE staff.worker_id = p.worker_id)
  ), merged AS (
    SELECT * FROM staff UNION ALL SELECT * FROM pool
  )
  SELECT m.kind, m.staff_id, m.worker_id, m.name, m.role, m.completed_shift_count, m.last_worked_at, m.block_reason,
         (SELECT a.status FROM public.shift_applications a
          WHERE p_shift_id IS NOT NULL AND a.shift_id = p_shift_id AND a.worker_id = m.worker_id) AS request_status
  FROM merged m
  ORDER BY (m.kind = 'pool'), (m.block_reason IS NOT NULL), m.completed_shift_count DESC NULLS LAST,
           m.last_worked_at DESC NULLS LAST, m.name;
END;
$$;
REVOKE ALL ON FUNCTION public.list_vacancy_candidates(uuid, date, time, time, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vacancy_candidates(uuid, date, time, time, text, uuid) TO authenticated;

-- 4) 요청 보내기 ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_to_vacancy(p_shift_id uuid, p_worker_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_facility_name text;
  v_label text;
  v_worker_id uuid;
  v_reason text;
  v_auth uuid;
  v_app_id uuid;
  v_sent integer := 0;
  v_skipped integer := 0;
BEGIN
  SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '근무를 찾을 수 없어요'; END IF;
  IF NOT public.can_manage_facility(v_shift.facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '결원을 관리할 권한이 없어요';
  END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION '이미 확정됐거나 닫힌 근무예요'; END IF;
  IF v_shift.audience = 'invited' THEN RAISE EXCEPTION '반복근무 요청 근무에는 다른 사람을 추가할 수 없어요'; END IF;
  IF (v_shift.shift_date + v_shift.start_time) <= timezone('Asia/Seoul', now()) THEN
    RAISE EXCEPTION '이미 시작한 근무예요';
  END IF;
  IF cardinality(COALESCE(p_worker_ids, ARRAY[]::uuid[])) = 0 OR cardinality(p_worker_ids) > 50 THEN
    RAISE EXCEPTION '요청할 사람을 1~50명 골라 주세요';
  END IF;

  SELECT name INTO v_facility_name FROM public.facilities WHERE id = v_shift.facility_id;
  v_label := to_char(v_shift.shift_date, 'FMMM월 FMDD일') || ' '
          || to_char(v_shift.start_time, 'HH24:MI') || '~' || to_char(v_shift.end_time, 'HH24:MI');

  FOREACH v_worker_id IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(p_worker_ids) x) LOOP
    v_reason := public.vacancy_block_reason(v_worker_id, v_shift.facility_id, v_shift.shift_date,
                                            v_shift.start_time, v_shift.end_time, v_shift.required_role);
    IF v_reason IS NOT NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    INSERT INTO public.shift_applications (shift_id, worker_id, status, confirm_on_accept, invited_by)
    VALUES (v_shift.id, v_worker_id, 'invited', true, auth.uid())
    ON CONFLICT (shift_id, worker_id) DO UPDATE
      SET status = 'invited', confirm_on_accept = true, invited_by = auth.uid(),
          cancelled_at = NULL, responded_at = NULL
      WHERE public.shift_applications.status IN ('cancelled','expired','rejected')
    RETURNING id INTO v_app_id;
    IF v_app_id IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;  -- 이미 요청·지원·확정 상태
    v_sent := v_sent + 1;

    SELECT auth_user_id INTO v_auth FROM public.workers WHERE id = v_worker_id;
    IF v_auth IS NOT NULL THEN
      INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
      VALUES (
        v_auth, 'shift.vacancy_invited',
        'shift.vacancy_invited:' || v_app_id::text || ':' || extract(epoch FROM now())::bigint::text,
        COALESCE(v_facility_name, '사업장') || '에서 근무를 요청했어요',
        format('%s · 먼저 수락하면 바로 확정돼요', v_label),
        jsonb_build_object('type','vacancy_invited','applicationId',v_app_id,'shiftId',v_shift.id,'url','/applications')
      ) ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('admin', auth.uid(), 'vacancy.invite', 'shift', v_shift.id,
          jsonb_build_object('sent', v_sent, 'skipped', v_skipped));
  RETURN jsonb_build_object('sent', v_sent, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.invite_to_vacancy(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_vacancy(uuid, uuid[]) TO authenticated;

-- 5) 근무자 응답 — 결원 요청은 먼저 수락한 사람으로 바로 확정, 반복근무 요청은 기존대로 ─────────
CREATE OR REPLACE FUNCTION public.respond_to_shift_invitation(p_application_id uuid, p_accept boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_app public.shift_applications%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_reason text;
  v_platform boolean;
  v_method text;
  v_label text;
  v_recipient uuid;
  r record;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '근무자 정보를 찾을 수 없어요'; END IF;

  SELECT * INTO v_app FROM public.shift_applications
  WHERE id = p_application_id AND worker_id = v_worker_id FOR UPDATE;
  IF NOT FOUND OR v_app.status <> 'invited' THEN RETURN false; END IF;

  -- 반복근무 요청(1명 지정): 수락하면 '지원'이 되고 사업장이 확정한다 — 기존 동작 그대로
  IF NOT v_app.confirm_on_accept THEN
    UPDATE public.shift_applications AS a
    SET status = CASE WHEN p_accept THEN 'applied' ELSE 'cancelled' END,
        applied_at = CASE WHEN p_accept THEN now() ELSE applied_at END,
        cancelled_at = CASE WHEN p_accept THEN NULL ELSE now() END
    FROM public.shifts AS s
    WHERE a.id = p_application_id
      AND a.shift_id = s.id
      AND s.status = 'open'
      AND s.audience = 'invited'
      AND s.invited_worker_id = v_worker_id
      AND s.shift_date >= (timezone('Asia/Seoul', now()))::date;
    RETURN FOUND;
  END IF;

  -- 결원 요청
  IF NOT p_accept THEN
    UPDATE public.shift_applications SET status = 'cancelled', cancelled_at = now(), responded_at = now()
    WHERE id = v_app.id;
    RETURN true;
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = v_app.shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION '이미 다른 분이 맡은 근무예요';
  END IF;
  IF (v_shift.shift_date + v_shift.start_time) <= timezone('Asia/Seoul', now()) THEN
    RAISE EXCEPTION '이미 시작한 근무예요';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = v_worker_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_worker_id::text, 1));
  v_reason := public.vacancy_block_reason(v_worker_id, v_shift.facility_id, v_shift.shift_date,
                                          v_shift.start_time, v_shift.end_time, v_shift.required_role);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '지금은 이 근무를 맡을 수 없어요 (%)', v_reason;
  END IF;

  -- 자격 근거: 대타 확정과 같은 규칙. 확인자는 요청을 보낸 관리자
  v_platform := v_worker.verification_status = 'approved';
  IF NOT v_platform THEN
    v_method := public.prior_facility_credential(v_worker_id, v_shift.facility_id);
  END IF;

  UPDATE public.shift_applications
  SET status = 'accepted', responded_at = now(), applied_at = COALESCE(applied_at, now()),
      credential_review_status = CASE WHEN v_platform THEN 'platform_verified' ELSE 'facility_confirmed' END,
      credential_confirmed_by = CASE WHEN v_platform THEN NULL ELSE v_app.invited_by END,
      credential_confirmed_at = CASE WHEN v_platform THEN NULL ELSE now() END,
      credential_verification_method = v_method
  WHERE id = v_app.id;

  UPDATE public.shifts
  SET status = 'matched', matched_worker_id = v_worker_id, matched_at = now(), updated_at = now()
  WHERE id = v_shift.id;

  v_label := to_char(v_shift.shift_date, 'FMMM월 FMDD일') || ' '
          || to_char(v_shift.start_time, 'HH24:MI') || '~' || to_char(v_shift.end_time, 'HH24:MI');

  -- 나머지 요청은 닫고, 공개 공고로 지원한 사람은 다른 지원자 선정으로
  PERFORM set_config('app.cover_swap', 'on', true);
  FOR r IN
    SELECT a.id, a.status, w.auth_user_id
    FROM public.shift_applications a JOIN public.workers w ON w.id = a.worker_id
    WHERE a.shift_id = v_shift.id AND a.id <> v_app.id AND a.status IN ('invited','applied')
  LOOP
    UPDATE public.shift_applications
    SET status = CASE WHEN r.status = 'invited' THEN 'expired' ELSE 'rejected' END, responded_at = now()
    WHERE id = r.id;
    IF r.status = 'invited' AND r.auth_user_id IS NOT NULL THEN
      INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
      VALUES (r.auth_user_id, 'shift.vacancy_filled', 'shift.vacancy_filled:' || r.id::text,
              '다른 분이 먼저 맡았어요', format('%s 근무는 확정됐어요. 요청에 마음 써 주셔서 고마워요.', v_label),
              jsonb_build_object('url','/applications','shiftId',v_shift.id))
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END LOOP;
  PERFORM set_config('app.cover_swap', 'off', true);

  IF v_worker.auth_user_id IS NOT NULL THEN
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (v_worker.auth_user_id, 'shift.accepted', 'shift.accepted:' || v_app.id::text,
            '🎉 근무가 확정됐어요', format('%s · ₩%s', v_label, to_char(v_shift.estimated_total_pay, 'FM999,999,999')),
            jsonb_build_object('type','accepted','applicationId',v_app.id,'shiftId',v_shift.id,'url','/applications'))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  FOR v_recipient IN SELECT public.facility_notification_recipients(v_shift.facility_id) LOOP
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (v_recipient, 'shift.vacancy_filled.admin',
            'shift.vacancy_filled.admin:' || v_shift.id::text || ':' || v_recipient::text,
            '결원이 채워졌어요', format('%s님이 %s 근무를 맡았어요.', COALESCE(v_worker.name, '근무자'), v_label),
            jsonb_build_object('url','/applications','shiftId',v_shift.id))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('worker', auth.uid(), 'vacancy.accept', 'shift', v_shift.id,
          jsonb_build_object('application_id', v_app.id, 'worker_id', v_worker_id));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_to_shift_invitation(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_shift_invitation(uuid, boolean) TO authenticated;

-- 6) 반복근무 요청 거절 시 근무를 닫는 트리거 — 결원 요청은 한 명이 거절해도 근무가 열려 있어야 한다 ──
DO $patch$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.close_cancelled_invited_shift()'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%NEW.confirm_on_accept%' THEN
    v_def := regexp_replace(v_def, '\mBEGIN\M',
      E'BEGIN\n  IF NEW.confirm_on_accept THEN RETURN NEW; END IF;', '');
    EXECUTE v_def;
  END IF;
END
$patch$;

-- 7) 공개 지원 함수: 'targeted' 근무는 요청받은 사람만 — 공고 목록에 없지만 id로 직접 지원하는 것도 막는다 ──
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.apply_to_shift(uuid)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%''targeted''%' THEN
    v_new := replace(v_def,
      'IF v_shift.audience = ''invited'' AND v_shift.invited_worker_id <> v_worker.id THEN',
      'IF (v_shift.audience = ''invited'' AND v_shift.invited_worker_id <> v_worker.id) OR v_shift.audience = ''targeted'' THEN');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'vacancy_invites: apply_to_shift source drifted — add the targeted guard manually';
    END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;
