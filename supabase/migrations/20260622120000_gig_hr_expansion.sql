-- ============================================================================
-- Gig + HR(노무관리) 확장 마이그레이션  (설계: docs/expansion-design.md, A 단계)
-- 원칙: 기존 코드 안 깨지게 ADDITIVE. 신규 org-scoped/과금 테이블에만 RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 버그 수정 — 2026 최저시급 9,860 → 10,320 (고용노동부 고시)
-- ----------------------------------------------------------------------------
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_hourly_wage_check;
ALTER TABLE shifts ADD CONSTRAINT shifts_hourly_wage_min
  CHECK (hourly_wage >= 10320);

-- ----------------------------------------------------------------------------
-- 1. 코어 일반화 — facilities = organizations (헬스케어 → 범용 사업장)
--    (점진 전환: facilities 테이블 유지 + 일반화 컬럼 추가)
-- ----------------------------------------------------------------------------
-- facility_type CHECK를 풀어 비(非)의료 업종 허용
ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_facility_type_check;

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS industry_code TEXT,                 -- 표준산업분류(외식/돌봄/의료…)
  ADD COLUMN IF NOT EXISTS employee_count INTEGER,             -- 상시 근로자 수
  ADD COLUMN IF NOT EXISTS is_5plus BOOLEAN
    GENERATED ALWAYS AS (COALESCE(employee_count, 0) >= 5) STORED,  -- 5인 이상 = 가산수당 의무
  ADD COLUMN IF NOT EXISTS plan_code TEXT;                     -- 현재 구독 플랜(아래 plans.code)

COMMENT ON COLUMN facilities.is_5plus IS '상시 5인 이상 → 연장·야간·휴일 가산 의무 (근로기준법 §11)';

-- 직군 일반화: workers.role(rn/na) 유지 + 무한 확장용 분류 테이블
CREATE TABLE IF NOT EXISTS job_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT UNIQUE NOT NULL,            -- 'rn','na','cook','server','caregiver'...
  name_ko    TEXT NOT NULL,
  sector     TEXT NOT NULL,                   -- 'healthcare','food','care','retail'...
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worker_jobs (
  worker_id        UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  job_category_id  UUID NOT NULL REFERENCES job_categories(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (worker_id, job_category_id)
);

INSERT INTO job_categories (code, name_ko, sector) VALUES
  ('rn','간호사','healthcare'), ('na','간호조무사','healthcare'),
  ('caregiver','요양보호사','care'), ('cook','조리원','food'),
  ('server','서빙','food'), ('cashier','캐셔','retail')
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. 과금/권한 — plans · plan_features · subscriptions · entitlements
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  code         TEXT PRIMARY KEY,              -- 'match_lite','hr','bundle','enterprise'
  name         TEXT NOT NULL,
  price_month  INTEGER NOT NULL DEFAULT 0,    -- 사업장 월 구독료(원)
  max_workers  INTEGER,                       -- NULL = 무제한
  is_recommended BOOLEAN DEFAULT FALSE,       -- 통합(앵커) = TRUE
  sort_order   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_features (
  plan_code    TEXT NOT NULL REFERENCES plans(code) ON DELETE CASCADE,
  feature_key  TEXT NOT NULL,                 -- 'match.*','hr.*','ent.*'
  PRIMARY KEY (plan_code, feature_key)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  plan_code    TEXT NOT NULL REFERENCES plans(code),
  status       TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing','active','past_due','canceled')),
  period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_end   TIMESTAMPTZ,
  billing_ref  TEXT,                          -- 결제사 구독 ID
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(org_id) WHERE status = 'active';

-- 실시간 게이팅용 (org × feature). plan_features에서 파생/동기화.
CREATE TABLE IF NOT EXISTS entitlements (
  org_id       UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  feature_key  TEXT NOT NULL,
  granted_until TIMESTAMPTZ,                  -- NULL = 무기한(활성 구독 동안)
  PRIMARY KEY (org_id, feature_key)
);

-- 플랜 시드 (통합 유도형: bundle = 추천/앵커)
INSERT INTO plans (code, name, price_month, max_workers, is_recommended, sort_order) VALUES
  ('match_lite','매칭 Lite', 0,    NULL, FALSE, 1),
  ('hr',        '노무관리',  49000, NULL, FALSE, 2),
  ('bundle',    '통합',      69000, NULL, TRUE,  3),
  ('enterprise','Enterprise',0,    NULL, FALSE, 4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO plan_features (plan_code, feature_key) VALUES
  -- 매칭(공통)
  ('match_lite','match.post_shift'), ('match_lite','match.matching'),
  ('match_lite','match.attendance'), ('match_lite','match.settlement'),
  -- 노무
  ('hr','hr.contract'), ('hr','hr.payslip'), ('hr','hr.ledger'),
  ('hr','hr.wage_calc'), ('hr','hr.audit_retention'), ('hr','hr.compliance_report'),
  -- 통합 = 매칭 + 노무
  ('bundle','match.post_shift'), ('bundle','match.matching'),
  ('bundle','match.attendance'), ('bundle','match.settlement'),
  ('bundle','hr.contract'), ('bundle','hr.payslip'), ('bundle','hr.ledger'),
  ('bundle','hr.wage_calc'), ('bundle','hr.audit_retention'), ('bundle','hr.compliance_report'),
  -- 엔터프라이즈 = 통합 + 확장
  ('enterprise','match.post_shift'), ('enterprise','match.matching'),
  ('enterprise','match.attendance'), ('enterprise','match.settlement'),
  ('enterprise','hr.contract'), ('enterprise','hr.payslip'), ('enterprise','hr.ledger'),
  ('enterprise','hr.wage_calc'), ('enterprise','hr.audit_retention'), ('enterprise','hr.compliance_report'),
  ('enterprise','ent.multi_store'), ('enterprise','ent.api'), ('enterprise','ent.insurance_filing')
ON CONFLICT DO NOTHING;

-- org이 특정 기능 권한을 갖는지 (앱·Edge Function 게이팅 헬퍼)
CREATE OR REPLACE FUNCTION org_has_feature(p_org_id UUID, p_feature TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM entitlements e
    WHERE e.org_id = p_org_id AND e.feature_key = p_feature
      AND (e.granted_until IS NULL OR e.granted_until > NOW())
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. 컴플라이언스 — 출퇴근 기록 해시체인 (2026 전자기록·위변조 방지)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID NOT NULL REFERENCES shift_attendances(id) ON DELETE RESTRICT,
  seq           BIGINT GENERATED ALWAYS AS IDENTITY,
  prev_hash     TEXT,                         -- 직전 레코드 payload_hash
  payload       JSONB NOT NULL,               -- 기록 스냅샷(체크인/아웃/위치/시간)
  payload_hash  TEXT NOT NULL,                -- sha256(prev_hash || payload)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_att ON attendance_audit(attendance_id);
COMMENT ON TABLE attendance_audit IS '출퇴근 기록 append-only 해시체인 — 위변조 방지·3년 보관(근로시간 전자기록 의무)';

-- ----------------------------------------------------------------------------
-- 4. RLS — 신규 테이블만 적용 (기존 앱 쿼리 영향 없음). service_role은 우회.
--    사업장 관리자(facilities.admin_user_id = auth.uid())만 자기 org 데이터 접근.
-- ----------------------------------------------------------------------------
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements  ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_admin_subscriptions ON subscriptions
  FOR ALL USING (
    org_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid())
  );

CREATE POLICY org_admin_entitlements ON entitlements
  FOR SELECT USING (
    org_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid())
  );

-- plans / plan_features = 공개 카탈로그 (읽기 전용 공개)
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read_plans ON plans FOR SELECT USING (TRUE);
CREATE POLICY public_read_plan_features ON plan_features FOR SELECT USING (TRUE);

-- ============================================================================
-- TODO(후속): 노무 본체 테이블(employment_contracts·payslips·payroll_ledger·
--   wage_calculations·break_periods·insurance_filings)은 C 단계에서 추가.
--   기존 테이블(facilities/shifts/...) RLS 정책 정비는 출시 전 별도 작업.
-- ============================================================================
