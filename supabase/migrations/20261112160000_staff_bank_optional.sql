-- 2026-11-12 직원 지급 계좌 검토 ① (사용자 승인: "1번 진행")
-- 월급 승인(transition_staff_wage_payment 'approve')이 facility_staff 의 은행·계좌 끝 4자리가 없으면 막혔다.
-- 이체는 사업장이 평소 방식(기업뱅킹·세무 대리인)으로 하고, 계좌 끝 4자리는 '확인용'일 뿐이라 승인 조건에서 뺀다.
-- 연결 직원의 계좌는 이제 근무자 앱 계좌(worker_bank_accounts)를 화면에서 바로 읽는다 — facility_staff 사본은 쓰지 않는다.
-- 함수 본문은 11/05 에 운영에서 한 번 더 고쳐졌으므로(hospital_qa_1105), 파일을 다시 쓰지 않고 운영 본문에서 그 IF 덩어리만 잘라 낸다.
DO $bank_optional$
DECLARE
  v_def text; v_new text;
  v_start int; v_msg int; v_end int; v_from int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'transition_staff_wage_payment';
  IF v_def IS NULL THEN RAISE NOTICE 'transition_staff_wage_payment 없음 — 건너뜀'; RETURN; END IF;

  v_start := strpos(v_def, 'IF v_staff.bank_name IS NULL');
  IF v_start = 0 THEN RAISE NOTICE '지급 계좌 조건이 이미 없음 — 건너뜀'; RETURN; END IF;
  v_msg := strpos(substr(v_def, v_start), '지급 은행과 계좌 끝 4자리를 먼저 등록해 주세요.');
  IF v_msg = 0 THEN RAISE EXCEPTION '지급 계좌 조건의 안내 문구를 찾지 못했어요(본문이 예상과 다름)'; END IF;
  v_from := v_start + v_msg - 1;
  v_end := strpos(substr(v_def, v_from), 'END IF;');
  IF v_end = 0 THEN RAISE EXCEPTION '지급 계좌 조건의 끝(END IF)을 찾지 못했어요'; END IF;

  v_new := substr(v_def, 1, v_start - 1)
    || '-- 지급 계좌(은행·끝 4자리)는 승인 조건이 아니다 — 이체는 사업장이 평소 방식으로 한다(2026-11-12 계좌 검토)'
    || substr(v_def, v_from + v_end - 1 + length('END IF;'));
  EXECUTE v_new;
  RAISE NOTICE 'transition_staff_wage_payment: 지급 계좌 조건 제거';
END $bank_optional$;
