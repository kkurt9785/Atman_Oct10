-- 워커 앱 안에서 회원 탈퇴 · 동의 철회
--
-- 개인정보 보호법은 동의 철회·탈퇴를 수집(가입)보다 어렵게 하지 않도록 한다. 그동안은 고객센터 요청만 가능했다.
--
-- ① set_my_consent: 마케팅 수신·위치정보 이용 동의를 언제든 켜고 끈다(이력은 worker_consents 에 쌓인다).
-- ② withdraw_my_account: 본인 계정 탈퇴.
--    - 로그인 계정(auth.users)은 삭제한다 → 같은 카카오로 다시 가입할 수 있다.
--    - 근무·출퇴근·지급 기록은 사업장의 근로관계 기록이라 처리방침대로 3년 보관한다.
--      그래서 workers 행은 남기되 이름·직군 외 개인정보(연락처·생년월일 일자·면허·사진·활동지역·계좌번호)를 지운다.
--    - workers.auth_user_id 는 ON DELETE CASCADE 라 먼저 끊는다(안 끊으면 근무 기록까지 연쇄 삭제된다).
--    - 삭제를 막는 참조(NO ACTION/RESTRICT, 예: QR 사용자)는 비울 수 있으면 비운다.
--    - 앞으로 남은 확정 근무가 있으면 막는다 — 대타를 구하거나 사업장과 정리한 뒤 탈퇴.
--    - 관리자 계정은 이 경로로 탈퇴하지 않는다(사업장 소유·청구가 걸려 있다).
--    면허 사진 파일은 앱이 본인 권한으로 먼저 지운다(storage 정책 license_photos_delete_own).

CREATE OR REPLACE FUNCTION public.set_my_consent(p_type text, p_granted boolean, p_version text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_worker_id uuid := public.current_worker_id();
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '근무자 정보를 찾을 수 없어요'; END IF;
  IF p_type NOT IN ('marketing', 'location_data') THEN RAISE EXCEPTION '바꿀 수 없는 동의 항목이에요'; END IF;
  INSERT INTO public.worker_consents (worker_id, consent_type, version, granted)
  VALUES (v_worker_id, p_type, left(COALESCE(NULLIF(p_version, ''), 'app'), 40), p_granted);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_consent(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_consent(text, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_my_account()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_worker public.workers%ROWTYPE;
  v_now_kst timestamp := timezone('Asia/Seoul', now());
  r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;

  IF EXISTS (SELECT 1 FROM public.facilities WHERE admin_user_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.facility_admin_access WHERE user_id = v_uid) THEN
    RAISE EXCEPTION '사업장 관리자 계정이에요. 관리자 탈퇴는 고객센터(010-9045-5699)로 문의해 주세요';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE auth_user_id = v_uid AND deleted_at IS NULL FOR UPDATE;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.shift_applications a
      JOIN public.shifts s ON s.id = a.shift_id
      WHERE a.worker_id = v_worker.id AND a.status = 'accepted' AND a.checked_out_at IS NULL
        AND s.status IN ('matched', 'in_progress')
        AND (s.shift_date + s.end_time + CASE WHEN s.is_overnight THEN interval '1 day' ELSE interval '0 day' END) > v_now_kst
    ) THEN
      RAISE EXCEPTION '확정된 근무가 남아 있어요. 대타를 구하거나 사업장과 정리한 뒤 탈퇴해 주세요';
    END IF;

    -- 답하지 않은 요청·지원과 진행 중 대타는 정리한다
    UPDATE public.shift_applications SET status = 'cancelled', cancelled_at = now()
    WHERE worker_id = v_worker.id AND status IN ('invited', 'applied');
    UPDATE public.shift_cover_requests SET status = 'cancelled', updated_at = now()
    WHERE requester_worker_id = v_worker.id AND status IN ('open', 'claimed');
    UPDATE public.shift_cover_requests SET status = 'open', claimer_worker_id = NULL, claimed_at = NULL, updated_at = now()
    WHERE claimer_worker_id = v_worker.id AND status = 'claimed';

    -- 사업장 쪽 연결: 인력풀에서 빼고, 직원 기록은 남기되 계정 연결만 끊는다
    DELETE FROM public.facility_worker_pool WHERE worker_id = v_worker.id;
    UPDATE public.facility_staff SET worker_id = NULL, updated_at = now() WHERE worker_id = v_worker.id;

    -- 계좌: 지급 기록이 참조하므로 행은 두고 계좌번호·예금주만 지운다(표시용 끝 4자리는 지급 이력 확인용으로 유지)
    UPDATE public.worker_bank_accounts
    SET account_number_encrypted = '\x'::bytea, account_holder_name = '탈퇴한 회원', deleted_at = COALESCE(deleted_at, now())
    WHERE worker_id = v_worker.id;

    DELETE FROM public.worker_credentials WHERE worker_id = v_worker.id;
    DELETE FROM public.worker_preferences WHERE worker_id = v_worker.id;

    INSERT INTO public.worker_consents (worker_id, consent_type, version, granted)
    SELECT v_worker.id, t, 'withdrawal', false
    FROM unnest(ARRAY['terms_of_service', 'privacy_policy', 'location_data', 'marketing']) AS t;

    -- 근무 기록용 이름·직군만 남기고 개인정보를 지운다. 생년월일은 연도만(나이대 확인용).
    UPDATE public.workers
    SET auth_user_id = NULL,
        kakao_id = 'withdrawn:' || id::text,
        phone = NULL, email = NULL,
        birth_date = make_date(extract(year FROM birth_date)::int, 1, 1),
        license_number = NULL, license_photo_url = NULL, profile_image_url = NULL,
        activity_center = NULL, activity_address_text = NULL, last_workplace = NULL,
        deleted_at = now()
    WHERE id = v_worker.id;
  END IF;

  DELETE FROM public.worker_location_prefs WHERE worker_id = v_uid;
  DELETE FROM public.worker_onboarding_drafts WHERE auth_user_id = v_uid;

  -- 로그인 계정 삭제를 막는 참조(NO ACTION/RESTRICT)는 비울 수 있는 것만 비운다
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col, a.attnotnull
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
      AND c.confdeltype IN ('a', 'r') AND c.connamespace = 'public'::regnamespace
  LOOP
    IF NOT r.attnotnull THEN
      EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = $1', r.tbl, r.col, r.col) USING v_uid;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('worker', NULL, 'worker.withdraw', 'worker', v_worker.id, jsonb_build_object('at', now()));

  DELETE FROM auth.users WHERE id = v_uid;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_my_account() TO authenticated;
