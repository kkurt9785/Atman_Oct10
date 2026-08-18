-- ============================================================================
-- 간호직 단계적 자격검증 후속 정리 (2026-08-18)
-- ① 감사 기록 문구 정합성 — 관리자 체크박스는 "원본, 공식 조회 또는 병원 내부
--    절차"로 완화됐는데 감사로그는 'original_checked_by_facility'로 원본 확인을
--    단정해 기록하고 있었다. 실제 진술과 기록을 일치시킨다.
-- ② 런칭 리워드 잠금 해제 — 프로필 마일스톤이 verification_status='approved'
--    AND 면허 보유를 요구해, 서류를 내지 않는 간호직은 영구히 달성 불가였다.
--    간호직은 경력·활동지역 등 프로필 완성으로 달성할 수 있게 한다.
-- ============================================================================

-- ① 감사 기록 method 값 정정 (fail-loud 문자열 패치)
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.confirm_application_credential(uuid)');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'confirm_application_credential not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%verified_by_facility%' THEN RAISE NOTICE 'already patched'; RETURN; END IF;
  patched := replace(def, '''original_checked_by_facility''', '''verified_by_facility''');
  IF patched = def THEN RAISE EXCEPTION 'audit method anchor not found'; END IF;
  -- 예외 메시지도 "원본"을 단정하지 않도록 함께 정렬
  patched := replace(patched, '면허·자격 원본 확인 후 채용을 확정해 주세요', '자격 확인 후 채용을 확정해 주세요');
  EXECUTE patched;
END $$;

-- accept 게이트 메시지도 동일 표현으로 (별도 함수)
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.accept_shift_application(uuid)');
  def text; patched text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO def;
  patched := replace(def, '면허·자격 원본 확인 후 채용을 확정해 주세요', '자격 확인 후 채용을 확정해 주세요');
  IF patched <> def THEN EXECUTE patched; END IF;
END $$;

-- ② 런칭 리워드: 간호직은 서류 없이도 프로필 마일스톤 달성 가능
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.sync_my_worker_rewards()');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE NOTICE 'sync_my_worker_rewards not found - skip'; RETURN; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%v_me.role IN (''rn'',''na'')%' THEN RAISE NOTICE 'already patched'; RETURN; END IF;
  patched := replace(def,
    'v_profile:=v_me.verification_status=''approved''
    AND (v_me.license_number IS NOT NULL OR v_me.license_photo_url IS NOT NULL)',
    'v_profile:=(
      (v_me.role IN (''rn'',''na'') AND v_me.experience_years IS NOT NULL AND NULLIF(trim(COALESCE(v_me.last_workplace,'''')),'''') IS NOT NULL)
      OR (v_me.verification_status=''approved''
          AND (v_me.license_number IS NOT NULL OR v_me.license_photo_url IS NOT NULL))
    )');
  IF patched = def THEN RAISE EXCEPTION 'reward profile milestone anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- 검증 (모두 true면 성공)
SELECT
  strpos(pg_get_functiondef('public.confirm_application_credential(uuid)'::regprocedure), 'verified_by_facility') > 0 AS audit_method_aligned,
  strpos(pg_get_functiondef('public.accept_shift_application(uuid)'::regprocedure), '자격 확인 후 채용을 확정') > 0 AS accept_message_aligned,
  COALESCE(strpos(pg_get_functiondef('public.sync_my_worker_rewards()'::regprocedure), 'v_me.role IN (''rn'',''na'')') > 0, false) AS reward_unlocked_for_nursing;
