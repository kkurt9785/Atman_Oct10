-- ============================================================================
-- 출시 전 하드닝 배치 (저비용 P0 묶음)
-- 감사 리포트 참조: P0-1, P0-2, P0-6, P0-9, P0-10, P0-11
-- admin-web은 service_role(RLS·컬럼권한 우회)로 동작하므로 아래 제약은
-- 오직 anon/authenticated(=worker-web, 로그인 워커)에만 적용된다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- P0-1 · 병원 온보딩(claim)이 참조하는 facilities.invite_code 컬럼 추가
--   lib/facility.ts claimFacility() 가 이 컬럼으로 초대코드를 검증한다.
--   기존 시설에는 랜덤 코드를 채워 넣는다. (운영: 아래 쿼리로 코드 조회 후 병원에 전달)
--     SELECT id, name, invite_code FROM facilities WHERE deleted_at IS NULL;
-- ----------------------------------------------------------------------------
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS invite_code TEXT;

UPDATE facilities
SET invite_code = upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8))
WHERE invite_code IS NULL;


-- ----------------------------------------------------------------------------
-- P0-2 · 웹푸시 구독 테이블 (코드가 쓰는데 마이그레이션에 없었음)
--   worker-web: worker_id = auth.users.id 로 upsert/delete (anon 키)
--   admin-web : workers.id → auth_user_id 로 변환 후 service_role 로 조회/발송
--   → 양측 모두 auth user id 기준으로 일치. 테이블만 생성하면 됨.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  worker_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 로그인 워커는 자기 구독만 관리 (select/insert/update/delete)
DROP POLICY IF EXISTS push_subscriptions_own ON push_subscriptions;
CREATE POLICY push_subscriptions_own ON push_subscriptions
  FOR ALL
  USING (auth.uid() = worker_id)
  WITH CHECK (auth.uid() = worker_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;

CREATE TRIGGER push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ----------------------------------------------------------------------------
-- P0-6 · 크레딧 이중 적립 레이스 차단 (DB 레벨 멱등성)
--   결제 성공 페이지는 주문당 (원금 earn) [+ (보너스 earn)] 을 같은 ref=orderId 로 삽입.
--   두 earn 행은 delta 가 서로 다르므로 (org_id, ref, delta) 로 유니크를 걸면
--   정상 2행은 통과하고, 동시/재시도로 인한 '동일 행' 중복 삽입만 거부된다.
--   앱은 이 위반(23505)을 '이미 처리됨'으로 처리한다. (success/page.tsx)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_earn_order
  ON credit_ledger (org_id, ref, delta)
  WHERE kind = 'earn' AND ref IS NOT NULL;


-- ----------------------------------------------------------------------------
-- P0-9 · 권한 상승 차단: 클라이언트가 profiles.role 을 'admin' 으로 못 바꾸게.
--   워커 온보딩은 role='worker'(및 onboarding_done) 설정이 정상 → 허용.
--   role='admin' 은 클라이언트 경로로 절대 불가 (관리자 승격은 서버/시드에서만).
--   service_role 은 RLS 우회하므로 영향 없음.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles: 본인 수정" ON profiles;
CREATE POLICY "profiles: 본인 수정" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND COALESCE(role, 'worker') <> 'admin');


-- ----------------------------------------------------------------------------
-- P0-10 · 워커 자가 승인 차단: workers 의 심사·세금 관련 컬럼을 본인이 못 바꾸게.
--   RLS WITH CHECK 는 OLD 값을 못 보므로(승인된 워커의 정상 프로필 수정까지 막힘)
--   BEFORE UPDATE 트리거로 OLD↔NEW 를 비교한다. SECURITY INVOKER(기본)라
--   current_user 가 실제 세션 롤(authenticated/service_role)을 반영한다.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_worker_self_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- 서버(service_role)·마이그레이션(postgres)은 통과
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  -- 본인 심사 제출(pending↔reviewing)은 허용하되, 자가 '승인'과 심사·세금 필드
  -- 조작은 차단한다. 실제 취약점은 verification_status='approved' 자가 설정.
  IF (NEW.verification_status IS DISTINCT FROM OLD.verification_status
        AND NEW.verification_status = 'approved')
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
     OR NEW.tax_type    IS DISTINCT FROM OLD.tax_type THEN
    RAISE EXCEPTION 'workers: 심사 승인/세금 컬럼은 본인이 수정할 수 없습니다';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workers_guard_self_update ON workers;
CREATE TRIGGER workers_guard_self_update
  BEFORE UPDATE ON workers
  FOR EACH ROW EXECUTE FUNCTION guard_worker_self_update();


-- ----------------------------------------------------------------------------
-- P0-11 · facilities 민감 컬럼(연락처 PII·사업자번호·qr_secret·invite_code)이
--   anon/authenticated 에게 전체 노출되던 문제를 컬럼 권한으로 축소.
--   admin-web 은 service_role 이라 영향 없음. worker-web(FacilitySheet)은
--   안전 컬럼만 select 하므로 정상 동작. RLS 행 필터(활성/미삭제)는 그대로 유지.
-- ----------------------------------------------------------------------------
REVOKE SELECT ON facilities FROM anon, authenticated;

GRANT SELECT (
  id, name, facility_type, address_text, location,
  is_active, approved_at, created_at, updated_at, deleted_at, plan_code,
  bed_count, main_department, has_parking, has_meals, has_uniform, emr_system, intro
) ON facilities TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- P0-3 · 체크아웃 스키마 드리프트 복구
--   (1) shift_applications 에 checked_in_at/checked_out_at 컬럼이 없어 체크인/아웃
--       미러 UPDATE 가 실패했고, worker-web 지원 페이지도 이 컬럼을 select 해 깨져 있었음.
--   (2) status CHECK 에 'completed' 가 없어 완료 처리가 거부됐음.
--   (3) 체크아웃 크레딧 차감(kind='spend', ref=shift_id)에 멱등성이 없어 재시도/재스캔
--       시 이중 차감 가능 → 시프트당 1회 유니크.
--   (attendances.actual_minutes 는 GENERATED 컬럼이라 앱에서 write 하지 않도록 코드 수정)
-- ----------------------------------------------------------------------------
ALTER TABLE shift_applications
  ADD COLUMN IF NOT EXISTS checked_in_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;

ALTER TABLE shift_applications DROP CONSTRAINT IF EXISTS shift_applications_status_check;
ALTER TABLE shift_applications ADD CONSTRAINT shift_applications_status_check
  CHECK (status IN ('applied','accepted','rejected','cancelled','expired','completed'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_spend_shift
  ON credit_ledger (org_id, ref)
  WHERE kind = 'spend' AND ref IS NOT NULL;
