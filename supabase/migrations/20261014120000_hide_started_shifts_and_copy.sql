-- 2026-10-14 QA 후속 (docs/QA_2026-10-14.md #20, P2 문구)
-- 1) 이미 시작한 공고는 조회·지원 RPC에서도 뺀다 — 지금까지는 화면 필터에만 의존했다.
-- 2) 근무자 화면에 그대로 보이는 서버 문구: '시프트' → '공고/근무', '워커' → '근무자', '매칭' → '채용', 출근 창 안내 '관리자' → '사업장'.
-- 기존 함수들은 런타임 패치가 쌓여 있어 전체 재정의 대신 pg_get_functiondef + replace 로 고친다.
-- 핵심 변경(시작 시각 검사)의 앵커가 없으면 중단하고, 문구 교체는 없으면 건너뛴다.

DO $patch$
DECLARE
  r record;
  v_def text;
  v_new text;
  v_hit boolean;
BEGIN
  -- ── get_nearby_open_shifts_secure: 시작 시각이 지난 공고 제외 ──────────────
  v_hit := false;
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_nearby_open_shifts_secure'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%(s.shift_date + s.start_time) > timezone(''Asia/Seoul'', now())%' THEN
      v_hit := true; CONTINUE; -- 이미 적용됨
    END IF;
    v_new := replace(v_def,
      E'AND s.shift_date >= (timezone(''Asia/Seoul'', now()))::date',
      E'AND s.shift_date >= (timezone(''Asia/Seoul'', now()))::date\n  AND (s.shift_date + s.start_time) > timezone(''Asia/Seoul'', now())');
    IF v_new <> v_def THEN
      EXECUTE v_new; v_hit := true;
    END IF;
  END LOOP;
  IF NOT v_hit THEN
    RAISE EXCEPTION 'hide_started_shifts: get_nearby_open_shifts_secure source drifted (anchor not found)';
  END IF;

  -- ── list_public_shifts / get_public_shift (공개 공고): 같은 검사 ─────────────
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('list_public_shifts', 'get_public_shift')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%(s.shift_date + s.start_time) > (now() AT TIME ZONE ''Asia/Seoul'')%' THEN CONTINUE; END IF;
    v_new := replace(v_def,
      E'AND s.shift_date >= (now() AT TIME ZONE ''Asia/Seoul'')::date',
      E'AND s.shift_date >= (now() AT TIME ZONE ''Asia/Seoul'')::date\n    AND (s.shift_date + s.start_time) > (now() AT TIME ZONE ''Asia/Seoul'')');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'hide_started_shifts: % source drifted (anchor not found)', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;

  -- ── apply_to_shift: 시작한 공고 지원 차단 + 문구 ───────────────────────────
  v_hit := false;
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'apply_to_shift'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    IF v_new LIKE '%v_shift.shift_date < (timezone(''Asia/Seoul'', now()))::date THEN%' THEN
      v_new := replace(v_new,
        'v_shift.shift_date < (timezone(''Asia/Seoul'', now()))::date THEN',
        '(v_shift.shift_date + v_shift.start_time) <= timezone(''Asia/Seoul'', now()) THEN');
      v_hit := true;
    ELSIF v_new LIKE '%(v_shift.shift_date + v_shift.start_time) <= timezone(''Asia/Seoul'', now()) THEN%' THEN
      v_hit := true; -- 이미 적용됨
    END IF;
    v_new := replace(v_new, '''이미 지난 시프트예요''', '''이미 시작한 공고예요''');
    v_new := replace(v_new, '''현재 지원할 수 없는 시프트예요''', '''현재 지원할 수 없는 공고예요''');
    v_new := replace(v_new, '''이미 지원한 시프트예요''', '''이미 지원한 공고예요''');
    v_new := replace(v_new, '''자격 조건이 맞지 않는 시프트예요''', '''자격 조건이 맞지 않는 공고예요''');
    v_new := replace(v_new, '''초대받은 워커만 지원할 수 있어요''', '''초대받은 근무자만 지원할 수 있어요''');
    v_new := replace(v_new, '''같은 시간대에 확정된 다른 시프트가 있어요''', '''같은 시간대에 확정된 다른 근무가 있어요''');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
  IF NOT v_hit THEN
    RAISE EXCEPTION 'hide_started_shifts: apply_to_shift source drifted (date check anchor not found)';
  END IF;

  -- ── record_unified_attendance: 출근 창 안내 '관리자' → '사업장' (없으면 건너뜀) ──
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_unified_attendance'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '관리자에게 수동 기록을 요청해 주세요', '사업장에 알려 수동 기록을 요청해 주세요');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;

  -- ── seed_chat_on_accept: 채팅 첫 안내 '매칭' → '채용', 해요체 (없으면 건너뜀) ──
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'seed_chat_on_accept'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '매칭이 확정됐어요!', '채용이 확정됐어요!');
    v_new := replace(v_new, '문의사항은 이 채팅으로 남겨주세요. 근무 종료 24시간 후 채팅이 잠기며, 기록은 분쟁 대비를 위해 보관됩니다.',
                            '궁금한 점은 이 채팅으로 남겨 주세요. 근무 종료 24시간 후 채팅이 잠기고, 기록은 분쟁에 대비해 보관해요.');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END
$patch$;
