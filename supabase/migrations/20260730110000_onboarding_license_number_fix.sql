-- ============================================================================
-- 온보딩 면허번호 유실 수정 (2026-07-30 최종감사 후속)
-- 문제: 온보딩이 번호 저장에 update_my_worker_profile을 재사용하는데, 이 함수는
--   경력·근무지·부서태그를 필수로 RAISE → 온보딩 직후 호출은 항상 실패(경고 삼킴)
--   → "번호만 입력" 약사·간호사는 심사 화면을 보지만 실제 제출물이 없음.
-- 해법: 번호만 저장하는 전용 RPC. 번호가 새로 들어오면 reviewing으로 전환.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_my_license_number(p_number text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_number text := NULLIF(trim(COALESCE(p_number, '')), '');
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;
  IF v_number IS NULL OR length(v_number) < 4 THEN
    RAISE EXCEPTION '면허 번호를 확인해 주세요';
  END IF;

  UPDATE public.workers
  SET license_number = v_number,
      verification_status = CASE
        WHEN license_number IS DISTINCT FROM v_number AND verification_status <> 'approved'
        THEN 'reviewing' ELSE verification_status
      END,
      updated_at = now()
  WHERE id = v_worker_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_license_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_license_number(text) TO authenticated;

-- 검증
SELECT has_function_privilege('authenticated', 'public.set_my_license_number(text)', 'EXECUTE')
  AS license_number_rpc_ready;
