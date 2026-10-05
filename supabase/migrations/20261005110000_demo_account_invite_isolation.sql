-- 시연 계정은 실제 사업장 초대를 받을 수 없다
--
-- 시연 계정(@demo.atman.co.kr·is_demo)은 누구나 같이 쓴다. 시연 중에 실제 초대 링크를 열고 '초대 수락'을 누르면
-- 실제 사업장의 근무자 자리가 공용 시연 계정에 묶여, 출퇴근·계좌·대화가 다른 방문자에게 보이게 된다.
-- 공고 지원은 20260908150000(demo_isolation_and_shift_gate)에서 이미 나눴고, 초대 수락도 같은 원칙으로 나눈다.
-- 화면은 이 오류를 받으면 '시연 끝내고 이 초대 받기'로 잇는다.

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.claim_facility_staff_invite(uuid)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%is_demo_account%' THEN
    v_new := replace(v_def,
      E') THEN RAISE EXCEPTION ''현재 연결할 수 없는 근무지예요.''; END IF;',
      E') THEN RAISE EXCEPTION ''현재 연결할 수 없는 근무지예요.''; END IF;\n\n  IF public.is_demo_account(auth.uid()) AND NOT EXISTS (\n    SELECT 1 FROM public.facilities f WHERE f.id = v_invite.facility_id AND f.is_demo\n  ) THEN RAISE EXCEPTION ''시연 계정으로는 실제 초대를 받을 수 없어요. 시연을 끝내고 내 계정으로 받아 주세요.''; END IF;');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'demo_account_invite_isolation: claim_facility_staff_invite source drifted';
    END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;
