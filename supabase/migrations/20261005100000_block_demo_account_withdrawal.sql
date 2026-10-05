-- 시연 계정은 탈퇴·동의 변경 불가
--
-- 시연 계정(@demo.atman.co.kr, workers.is_demo)은 시작 화면 '써보기'로 누구나 같이 쓴다.
-- 한 사람이 탈퇴를 누르면 로그인 계정이 지워져 모든 방문자·영업 시연이 멈추고,
-- 위치 동의를 끄면 다른 방문자의 출근하기도 GPS 없이 동작한다.
-- 화면에서는 시연 중 탈퇴·동의 버튼 대신 '시연 끝내고 가입하기'를 보여 주고, DB에서도 막는다.

CREATE OR REPLACE FUNCTION public.is_demo_account(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_uid AND lower(u.email) LIKE '%@demo.atman.co.kr')
      OR EXISTS (SELECT 1 FROM public.workers w WHERE w.auth_user_id = p_uid AND w.is_demo);
$$;
REVOKE ALL ON FUNCTION public.is_demo_account(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_my_consent(p_type text, p_granted boolean, p_version text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_worker_id uuid := public.current_worker_id();
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '근무자 정보를 찾을 수 없어요'; END IF;
  IF public.is_demo_account(auth.uid()) THEN RAISE EXCEPTION '시연 계정은 동의를 바꿀 수 없어요. 시연을 끝내고 내 계정으로 시작해 주세요'; END IF;
  IF p_type NOT IN ('marketing', 'location_data') THEN RAISE EXCEPTION '바꿀 수 없는 동의 항목이에요'; END IF;
  INSERT INTO public.worker_consents (worker_id, consent_type, version, granted)
  VALUES (v_worker_id, p_type, left(COALESCE(NULLIF(p_version, ''), 'app'), 40), p_granted);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_consent(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_consent(text, boolean, text) TO authenticated;

-- withdraw_my_account 는 보관 기간 마이그레이션이 이미 한 번 고쳤으므로 현재 정의에 조건만 끼워 넣는다
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.withdraw_my_account()'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%is_demo_account%' THEN
    v_new := replace(v_def,
      E'IF v_uid IS NULL THEN RAISE EXCEPTION ''로그인이 필요해요''; END IF;',
      E'IF v_uid IS NULL THEN RAISE EXCEPTION ''로그인이 필요해요''; END IF;\n\n  IF public.is_demo_account(v_uid) THEN\n    RAISE EXCEPTION ''시연 계정은 탈퇴할 수 없어요. 시연을 끝내고 내 계정으로 시작해 주세요'';\n  END IF;');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'block_demo_account_withdrawal: withdraw_my_account source drifted';
    END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;
