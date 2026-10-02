-- 결원 요청 수락 시: 사업장이 취소한 근무를 "이미 다른 분이 맡은 근무예요"로 안내하던 것 바로잡기
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.respond_to_shift_invitation(uuid,boolean)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%사업장이 취소한 근무예요%' THEN
    v_new := replace(v_def,
      E'IF NOT FOUND OR v_shift.status <> ''open'' THEN\n    RAISE EXCEPTION ''이미 다른 분이 맡은 근무예요'';',
      E'IF FOUND AND v_shift.status = ''cancelled'' THEN\n    RAISE EXCEPTION ''사업장이 취소한 근무예요'';\n  END IF;\n  IF NOT FOUND OR v_shift.status <> ''open'' THEN\n    RAISE EXCEPTION ''이미 다른 분이 맡은 근무예요'';');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'vacancy_cancelled_message: respond_to_shift_invitation source drifted';
    END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;
