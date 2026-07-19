-- ============================================================================
-- 데모 마스터 초대코드 '2026' — 데모 기간 한정 만능키
--   * 켜져 있는 동안: 어느 병원이든 '2026' 입력 시 연결 통과
--     (이전 소유 자동 해제 + 대상 병원 인수 — 1계정1병원·선점 충돌 자동 해소)
--   * 데모 종료 시 원복(한 줄):
--       UPDATE public.app_demo_settings SET master_invite_enabled = false;
--   * 재활성화:
--       UPDATE public.app_demo_settings SET master_invite_enabled = true;
--   ⚠️ 실서비스 오픈 전 반드시 OFF — 출시 전 체크리스트 항목
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_demo_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),   -- 싱글 행 강제
  master_invite_code_hash text,
  master_invite_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_demo_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_demo_settings FROM anon, authenticated;

INSERT INTO public.app_demo_settings (id, master_invite_code_hash, master_invite_enabled)
VALUES (true, extensions.crypt('2026', extensions.gen_salt('bf')), true)
ON CONFLICT (id) DO UPDATE
  SET master_invite_code_hash = EXCLUDED.master_invite_code_hash,
      master_invite_enabled = true,
      updated_at = now();

-- claim_facility_secure 확장: 마스터 코드 우선 검사, 실패 시 기존 경로 그대로
CREATE OR REPLACE FUNCTION public.claim_facility_secure(
  p_facility_id uuid,
  p_invite_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility public.facilities%ROWTYPE;
  v_is_admin boolean;
  v_master public.app_demo_settings%ROWTYPE;
  v_master_ok boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION '관리자 계정만 병원을 연결할 수 있어요';
  END IF;

  SELECT * INTO v_facility
  FROM public.facilities
  WHERE id = p_facility_id
    AND is_active = true
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '병원을 찾을 수 없어요';
  END IF;

  SELECT * INTO v_master FROM public.app_demo_settings WHERE id = true;
  IF FOUND
     AND v_master.master_invite_enabled
     AND v_master.master_invite_code_hash IS NOT NULL
     AND extensions.crypt(upper(trim(p_invite_code)), v_master.master_invite_code_hash)
         = v_master.master_invite_code_hash THEN
    v_master_ok := true;
  END IF;

  IF v_master_ok THEN
    -- 데모 경로: 반복 시연을 위해 충돌을 자동 해소하고 무조건 통과.
    -- 크레딧 지급(구모델 레거시)은 데모 경로에서 생략.
    UPDATE public.facilities
    SET admin_user_id = NULL, updated_at = now()
    WHERE admin_user_id = auth.uid() AND id <> p_facility_id;

    UPDATE public.facilities
    SET admin_user_id = auth.uid(),
        invite_code_used_at = now(),
        invite_failed_attempts = 0,
        invite_locked_until = NULL,
        updated_at = now()
    WHERE id = p_facility_id;

    INSERT INTO public.audit_logs (
      actor_type, actor_id, action, entity_type, entity_id, after_data
    ) VALUES (
      'admin', auth.uid(), 'facility.claim.demo_master', 'facility', p_facility_id,
      jsonb_build_object('admin_user_id', auth.uid())
    );

    RETURN p_facility_id;
  END IF;

  -- ── 이하 정상 경로 (기존 로직 그대로) ──────────────────────────────
  IF v_facility.admin_user_id IS NOT NULL AND v_facility.admin_user_id <> auth.uid() THEN
    RAISE EXCEPTION '이미 다른 계정에서 연결된 병원이에요';
  END IF;
  IF v_facility.invite_locked_until IS NOT NULL AND v_facility.invite_locked_until > now() THEN
    RAISE EXCEPTION '초대 코드 입력이 잠시 잠겼어요. 나중에 다시 시도해 주세요';
  END IF;
  IF v_facility.invite_code_hash IS NULL
     OR (v_facility.invite_code_expires_at IS NOT NULL AND v_facility.invite_code_expires_at <= now()) THEN
    RAISE EXCEPTION '초대 코드가 만료됐어요. 새 코드를 요청해 주세요';
  END IF;

  IF extensions.crypt(upper(trim(p_invite_code)), v_facility.invite_code_hash) <> v_facility.invite_code_hash THEN
    UPDATE public.facilities
    SET invite_failed_attempts = invite_failed_attempts + 1,
        invite_locked_until = CASE
          WHEN invite_failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE invite_locked_until
        END
    WHERE id = p_facility_id;
    RAISE EXCEPTION '초대 코드가 올바르지 않아요';
  END IF;

  UPDATE public.facilities
  SET admin_user_id = auth.uid(),
      invite_code = NULL,
      invite_code_used_at = now(),
      invite_failed_attempts = 0,
      invite_locked_until = NULL,
      updated_at = now()
  WHERE id = p_facility_id;

  INSERT INTO public.credit_ledger (org_id, delta, kind, ref, expires_at)
  SELECT p_facility_id, 30000, 'onboard_signup', 'facility-claim', NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE org_id = p_facility_id AND kind = 'onboard_signup'
  );

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    'admin', auth.uid(), 'facility.claim', 'facility', p_facility_id,
    jsonb_build_object('admin_user_id', auth.uid())
  );

  RETURN p_facility_id;
END;
$$;
