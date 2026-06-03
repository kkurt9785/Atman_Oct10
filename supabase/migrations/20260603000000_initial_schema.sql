-- ============================================================================
-- Atman MVP Database Schema
-- Target: Supabase (PostgreSQL 15+ with PostGIS)
-- Phase 1: 야간 간호 시프트 매칭 (서울/경기, 요양병원)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- 시설명·병원명 검색용

-- ----------------------------------------------------------------------------
-- 1. workers (간호사·간호조무사)
-- ----------------------------------------------------------------------------
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Kakao OAuth
  kakao_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  birth_date DATE NOT NULL,
  profile_image_url TEXT,

  -- 직군 (PHASE 1: rn=정규간호사, na=간호조무사)
  role TEXT NOT NULL CHECK (role IN ('rn', 'na')),

  -- 활동 지역 (PostGIS)
  activity_center geography(POINT, 4326),
  activity_radius_meters INTEGER DEFAULT 5000
    CHECK (activity_radius_meters BETWEEN 1000 AND 30000),
  activity_address_text TEXT,

  -- 심사
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'reviewing', 'approved', 'rejected')),
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  rejection_reason TEXT,

  -- 세금 분류 (3.3% 원천징수)
  tax_type TEXT NOT NULL DEFAULT 'freelancer'
    CHECK (tax_type IN ('freelancer', 'daily_worker')),

  -- 활동성
  last_active_at TIMESTAMPTZ,

  -- 메타
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ

  -- 18+ 게이트는 트리거로 검증 (CHECK는 IMMUTABLE 함수만 허용)
);

CREATE INDEX idx_workers_kakao ON workers(kakao_id);
CREATE INDEX idx_workers_status ON workers(verification_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_workers_activity ON workers USING GIST(activity_center)
  WHERE deleted_at IS NULL AND verification_status = 'approved';
CREATE INDEX idx_workers_role ON workers(role) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. worker_credentials (Credential Passport - IntelyCare 영감)
-- ----------------------------------------------------------------------------
CREATE TABLE worker_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,

  credential_type TEXT NOT NULL CHECK (credential_type IN (
    'nursing_license',     -- 간호사 면허증
    'na_certificate',      -- 간호조무사 자격증
    'id_card',             -- 신분증
    'health_check',        -- 건강진단서
    'cpr_cert',            -- BLS/CPR
    'tuberculosis_test',   -- 결핵검사
    'vaccination',         -- 예방접종 (코로나/독감)
    'other'
  )),

  -- 문서
  document_url TEXT NOT NULL,           -- Supabase Storage URL
  document_number TEXT,                 -- 면허번호 (OCR 결과)
  issuing_authority TEXT,               -- 발급기관 (보건복지부 등)

  -- 유효기간
  issued_at DATE,
  expires_at DATE,

  -- 인증
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected', 'expired')),
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  rejection_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credentials_worker ON worker_credentials(worker_id);
CREATE INDEX idx_credentials_expiry ON worker_credentials(expires_at)
  WHERE verification_status = 'approved' AND expires_at IS NOT NULL;
CREATE INDEX idx_credentials_status ON worker_credentials(verification_status);

-- ----------------------------------------------------------------------------
-- 3. worker_bank_accounts (계좌 - pgcrypto 암호화)
-- ----------------------------------------------------------------------------
CREATE TABLE worker_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,

  -- 은행 (한국은행 표준 코드)
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,

  -- 계좌번호: 암호화 저장
  account_number_encrypted BYTEA NOT NULL,
  account_number_last4 TEXT NOT NULL,  -- 마스킹 표시용

  account_holder_name TEXT NOT NULL,

  -- 1원 인증
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'sent', 'verified', 'failed')),
  one_won_sent_at TIMESTAMPTZ,
  one_won_imprint TEXT,                 -- 입금자명에 표시된 4자리
  verified_at TIMESTAMPTZ,
  verification_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,             -- 5회 실패 시 30분 잠금

  is_primary BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_bank_primary
  ON worker_bank_accounts(worker_id)
  WHERE is_primary = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_bank_worker ON worker_bank_accounts(worker_id);

-- ----------------------------------------------------------------------------
-- 4. worker_consents (약관 동의 이력 - 법적 증빙)
-- ----------------------------------------------------------------------------
CREATE TABLE worker_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,

  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'age_over_18',            -- 만 18세 이상 확인
    'terms_of_service',       -- 이용약관
    'privacy_policy',         -- 개인정보 수집·이용
    'location_data',          -- 위치정보 이용
    'marketing'               -- (선택) 마케팅 수신
  )),

  version TEXT NOT NULL,      -- 'v1.0', 'v1.1' (개정 추적)
  granted BOOLEAN NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 법적 증빙
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX idx_consents_worker_type ON worker_consents(worker_id, consent_type);
CREATE INDEX idx_consents_version ON worker_consents(consent_type, version);

-- ----------------------------------------------------------------------------
-- 5. push_tokens (Expo Push)
-- ----------------------------------------------------------------------------
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,

  expo_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  device_model TEXT,

  is_active BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (worker_id, expo_token)
);

CREATE INDEX idx_push_active ON push_tokens(worker_id) WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- 6. worker_preferences (Phase 2 대비, 스키마 미리 잡기)
-- ----------------------------------------------------------------------------
CREATE TABLE worker_preferences (
  worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,

  -- 선호/제외 시설
  preferred_facility_ids UUID[] DEFAULT '{}',
  excluded_facility_ids UUID[] DEFAULT '{}',

  -- 근무 가능 요일 (월=1 ~ 일=7)
  available_weekdays INTEGER[] DEFAULT '{1,2,3,4,5,6,7}',

  -- 시간대 선호
  prefer_night_only BOOLEAN DEFAULT TRUE,
  earliest_start_time TIME,
  latest_end_time TIME,

  -- 최소 시급 (이 이하 푸시 X)
  min_hourly_wage INTEGER,

  -- 알림 설정
  notify_new_shifts BOOLEAN DEFAULT TRUE,
  notify_quiet_start TIME DEFAULT '23:00',
  notify_quiet_end TIME DEFAULT '08:00',

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 7. facilities (시설 - 요양병원·소형병원)
-- ----------------------------------------------------------------------------
CREATE TABLE facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,
  facility_type TEXT NOT NULL CHECK (facility_type IN (
    'care_hospital',          -- 요양병원
    'general_hospital',       -- 종합병원
    'small_hospital',         -- 의원/병원
    'clinic',                 -- 의원
    'nursing_home',           -- 요양원
    'home_health'             -- 방문간호
  )),

  -- 사업자 정보
  business_registration_number TEXT UNIQUE NOT NULL,
  representative_name TEXT,

  -- 주소·위치
  address_text TEXT NOT NULL,
  location geography(POINT, 4326) NOT NULL,

  -- 담당자 (단일 담당자 - facility_admins 분리는 Phase 2)
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  admin_user_id UUID UNIQUE REFERENCES auth.users(id),

  -- QR 인증 (Vault에 secret 저장, 여기는 secret 참조 ID만)
  qr_secret_ref TEXT,                   -- vault.secrets 참조

  -- 운영
  is_active BOOLEAN DEFAULT TRUE,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_facilities_location ON facilities USING GIST(location);
CREATE INDEX idx_facilities_active ON facilities(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_facilities_name_trgm ON facilities USING GIN(name gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 8. shifts (시프트 공고)
-- ----------------------------------------------------------------------------
CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,

  -- 요구 자격
  required_role TEXT NOT NULL CHECK (required_role IN ('rn', 'na', 'any')),
  required_credentials TEXT[] DEFAULT '{}',  -- 추가 자격증 요구 시

  -- 일정
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_overnight BOOLEAN GENERATED ALWAYS AS (end_time < start_time) STORED,

  -- 임금
  hourly_wage INTEGER NOT NULL CHECK (hourly_wage >= 9860),  -- 2026 최저시급 가드
  night_premium_rate NUMERIC(3,2) DEFAULT 1.50,
  estimated_total_pay INTEGER NOT NULL,
  platform_fee_rate NUMERIC(4,3) DEFAULT 0.120,  -- 12% 수수료

  -- 상세 (카이테크 미스매치 방지)
  description TEXT NOT NULL,
  department TEXT,                      -- 일반병동/중환자실 등
  patient_count INTEGER,
  notes TEXT,                           -- 복장·식사·교통 등

  -- 매칭
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',           -- 모집중
    'matched',        -- 매칭완료
    'in_progress',    -- 근무중
    'completed',      -- 완료
    'cancelled'       -- 취소
  )),
  matched_worker_id UUID REFERENCES workers(id),
  matched_at TIMESTAMPTZ,

  posted_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 인덱스 predicate에 CURRENT_DATE 불가 (IMMUTABLE 아님). 쿼리에서 shift_date 필터링.
CREATE INDEX idx_shifts_open ON shifts(shift_date, status)
  WHERE status = 'open';
CREATE INDEX idx_shifts_facility ON shifts(facility_id);
CREATE INDEX idx_shifts_matched_worker ON shifts(matched_worker_id) WHERE matched_worker_id IS NOT NULL;
CREATE INDEX idx_shifts_date ON shifts(shift_date);

-- ----------------------------------------------------------------------------
-- 9. shift_applications (지원·매칭)
-- ----------------------------------------------------------------------------
CREATE TABLE shift_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN (
    'applied',        -- 지원
    'accepted',       -- 시설 수락
    'rejected',       -- 거절
    'cancelled',      -- 워커 취소
    'expired'         -- 자동 만료
  )),

  -- 매칭 점수 (자동매칭 알고리즘)
  match_score NUMERIC(4,2),
  distance_meters INTEGER,

  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  UNIQUE (shift_id, worker_id)
);

CREATE INDEX idx_applications_shift ON shift_applications(shift_id);
CREATE INDEX idx_applications_worker ON shift_applications(worker_id, applied_at DESC);
CREATE INDEX idx_applications_status ON shift_applications(status);

-- ----------------------------------------------------------------------------
-- 10. shift_attendances (QR 출퇴근)
-- ----------------------------------------------------------------------------
CREATE TABLE shift_attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id),
  worker_id UUID NOT NULL REFERENCES workers(id),
  application_id UUID NOT NULL REFERENCES shift_applications(id),

  -- 출근
  check_in_at TIMESTAMPTZ,
  check_in_location geography(POINT, 4326),
  check_in_distance_m INTEGER,          -- 시설 location과의 거리
  check_in_method TEXT CHECK (check_in_method IN ('button', 'qr')),

  -- 퇴근 (QR)
  check_out_at TIMESTAMPTZ,
  check_out_location geography(POINT, 4326),
  check_out_distance_m INTEGER,
  check_out_qr_nonce TEXT,              -- 재사용 방지
  check_out_hmac_verified BOOLEAN,
  check_out_method TEXT CHECK (check_out_method IN ('qr', 'manual_override')),

  -- 자동 계산
  actual_minutes INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN check_in_at IS NOT NULL AND check_out_at IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60)::INTEGER
      ELSE NULL
    END
  ) STORED,

  -- 이슈
  has_dispute BOOLEAN DEFAULT FALSE,
  dispute_note TEXT,
  manual_override_by UUID,
  manual_override_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (application_id)
);

CREATE INDEX idx_attendances_shift ON shift_attendances(shift_id);
CREATE INDEX idx_attendances_worker ON shift_attendances(worker_id);
CREATE INDEX idx_attendances_dispute ON shift_attendances(has_dispute) WHERE has_dispute = TRUE;

-- ----------------------------------------------------------------------------
-- 11. settlements (정산 - 3.3% 원천징수)
-- ----------------------------------------------------------------------------
CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id),
  worker_id UUID NOT NULL REFERENCES workers(id),
  attendance_id UUID NOT NULL REFERENCES shift_attendances(id),
  bank_account_id UUID NOT NULL REFERENCES worker_bank_accounts(id),

  -- 금액 분해
  gross_pay INTEGER NOT NULL,                -- 총 지급액 (시급×시간×야간가산)
  platform_fee INTEGER NOT NULL,             -- 12% (시설 측 부담, 표시용)
  income_tax INTEGER NOT NULL,               -- 3% 소득세
  local_tax INTEGER NOT NULL,                -- 0.3% 지방소득세
  tax_withheld INTEGER GENERATED ALWAYS AS (income_tax + local_tax) STORED,
  net_pay INTEGER NOT NULL,                  -- 실수령 = gross - tax_withheld

  -- 상태
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',        -- 대기
    'processing',     -- 송금중
    'paid',           -- 입금완료
    'failed',         -- 실패
    'disputed'        -- 이의제기
  )),

  -- 외부 핀테크 (토스페이먼츠 등)
  external_provider TEXT,                    -- 'toss', 'kg_inicis' 등
  external_transfer_id TEXT,
  initiated_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  failure_reason TEXT,

  -- 세금 신고용 (연말 국세청)
  withholding_report_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (attendance_id)
);

CREATE INDEX idx_settlements_worker ON settlements(worker_id, created_at DESC);
CREATE INDEX idx_settlements_status ON settlements(status);
CREATE INDEX idx_settlements_paid ON settlements(paid_at) WHERE status = 'paid';

-- ----------------------------------------------------------------------------
-- 12. shift_reviews (양방향 평가 - Phase 2 대비)
-- ----------------------------------------------------------------------------
CREATE TABLE shift_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id),
  attendance_id UUID NOT NULL REFERENCES shift_attendances(id),

  -- 리뷰 방향
  direction TEXT NOT NULL CHECK (direction IN ('worker_to_facility', 'facility_to_worker')),

  reviewer_worker_id UUID REFERENCES workers(id),
  reviewer_facility_id UUID REFERENCES facilities(id),

  reviewee_worker_id UUID REFERENCES workers(id),
  reviewee_facility_id UUID REFERENCES facilities(id),

  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,

  -- 카테고리별 점수 (선택)
  punctuality INTEGER CHECK (punctuality BETWEEN 1 AND 5),
  professionalism INTEGER CHECK (professionalism BETWEEN 1 AND 5),
  environment INTEGER CHECK (environment BETWEEN 1 AND 5),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 한 시프트당 방향별 1회
  UNIQUE (shift_id, direction)
);

CREATE INDEX idx_reviews_reviewee_worker ON shift_reviews(reviewee_worker_id);
CREATE INDEX idx_reviews_reviewee_facility ON shift_reviews(reviewee_facility_id);

-- ----------------------------------------------------------------------------
-- 13. audit_logs (의료법 분쟁 대비)
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  actor_type TEXT NOT NULL CHECK (actor_type IN ('worker', 'facility', 'admin', 'system')),
  actor_id UUID,

  action TEXT NOT NULL,                 -- 'credential.approve', 'shift.cancel'
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,

  before_data JSONB,
  after_data JSONB,

  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 만 18세 이상 검증 (CHECK 대신 트리거)
CREATE OR REPLACE FUNCTION check_age_18()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.birth_date > CURRENT_DATE - INTERVAL '18 years' THEN
    RAISE EXCEPTION '만 18세 미만은 가입할 수 없습니다 (birth_date: %)', NEW.birth_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workers_age_18
  BEFORE INSERT OR UPDATE OF birth_date ON workers
  FOR EACH ROW EXECUTE FUNCTION check_age_18();

CREATE TRIGGER trg_workers_updated BEFORE UPDATE ON workers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_credentials_updated BEFORE UPDATE ON worker_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_facilities_updated BEFORE UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_shifts_updated BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_attendances_updated BEFORE UPDATE ON shift_attendances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_push_updated BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_preferences_updated BEFORE UPDATE ON worker_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- FUNCTIONS: 핵심 비즈니스 로직
-- ============================================================================

-- 반경 내 활성 워커 찾기 (시프트 공고 → 푸시 대상)
-- 최적화: 고정 max(GIST 인덱스 활용) → 워커 본인 반경 필터 2단계
CREATE OR REPLACE FUNCTION find_workers_in_radius(
  p_facility_location geography,
  p_required_role TEXT,
  p_max_distance_meters INTEGER DEFAULT 30000
)
RETURNS TABLE (
  worker_id UUID,
  distance_meters INTEGER,
  expo_token TEXT
) AS $$
  SELECT
    w.id,
    ST_Distance(w.activity_center, p_facility_location)::INTEGER AS distance_m,
    pt.expo_token
  FROM workers w
  LEFT JOIN push_tokens pt ON pt.worker_id = w.id AND pt.is_active = TRUE
  WHERE w.deleted_at IS NULL
    AND w.verification_status = 'approved'
    AND (p_required_role = 'any' OR w.role = p_required_role)
    -- 1단계: 고정 max로 GIST 인덱스 활용 (bounding box prefilter)
    AND ST_DWithin(w.activity_center, p_facility_location, p_max_distance_meters)
    -- 2단계: 워커 본인 반경으로 정확히 필터
    AND ST_DWithin(w.activity_center, p_facility_location, w.activity_radius_meters)
  ORDER BY distance_m ASC;
$$ LANGUAGE sql STABLE;

-- 정산 금액 계산 (3.3% 원천징수)
CREATE OR REPLACE FUNCTION calculate_settlement(
  p_gross_pay INTEGER
)
RETURNS TABLE (
  income_tax INTEGER,
  local_tax INTEGER,
  net_pay INTEGER
) AS $$
  SELECT
    (p_gross_pay * 0.03)::INTEGER AS income_tax,
    (p_gross_pay * 0.003)::INTEGER AS local_tax,
    (p_gross_pay - (p_gross_pay * 0.033)::INTEGER) AS net_pay;
$$ LANGUAGE sql IMMUTABLE;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Supabase 표준 패턴
-- ============================================================================

ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- workers: 본인 데이터만
CREATE POLICY workers_select_own ON workers FOR SELECT
  USING (auth_user_id = auth.uid());
CREATE POLICY workers_update_own ON workers FOR UPDATE
  USING (auth_user_id = auth.uid());

-- credentials: 본인 것만
CREATE POLICY credentials_own ON worker_credentials FOR ALL
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- bank_accounts: 본인 것만
CREATE POLICY bank_own ON worker_bank_accounts FOR ALL
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- consents: 본인 것만, insert/select만
CREATE POLICY consents_insert ON worker_consents FOR INSERT
  WITH CHECK (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY consents_select ON worker_consents FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- preferences: 본인 것만
CREATE POLICY preferences_own ON worker_preferences FOR ALL
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- push_tokens: 본인 것만
CREATE POLICY push_own ON push_tokens FOR ALL
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- facilities: 공개 읽기 (활성만), 본인 시설만 수정
CREATE POLICY facilities_public_read ON facilities FOR SELECT
  USING (is_active = TRUE AND deleted_at IS NULL);
CREATE POLICY facilities_admin_write ON facilities FOR UPDATE
  USING (admin_user_id = auth.uid());

-- shifts: 모든 워커가 공개된 시프트 조회, 시설은 본인 것만 수정
CREATE POLICY shifts_public_read ON shifts FOR SELECT
  USING (status IN ('open', 'matched'));
CREATE POLICY shifts_facility_write ON shifts FOR ALL
  USING (facility_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid()));

-- applications: 워커는 본인 지원만, 시설은 자기 시프트 지원자 조회
CREATE POLICY applications_worker ON shift_applications FOR ALL
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY applications_facility_read ON shift_applications FOR SELECT
  USING (shift_id IN (
    SELECT id FROM shifts WHERE facility_id IN (
      SELECT id FROM facilities WHERE admin_user_id = auth.uid()
    )
  ));

-- attendances: 본인 것만 (양측 모두 조회는 시설 정책 별도)
CREATE POLICY attendances_worker ON shift_attendances FOR ALL
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- settlements: 본인 것만 (읽기)
CREATE POLICY settlements_worker_read ON settlements FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- reviews: 모두 읽기, 작성은 본인만
CREATE POLICY reviews_public_read ON shift_reviews FOR SELECT
  USING (TRUE);
CREATE POLICY reviews_worker_write ON shift_reviews FOR INSERT
  WITH CHECK (reviewer_worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- audit_logs: service_role만 (정책 X = 일반 접근 차단)
-- (Supabase에서 service_role은 RLS bypass)

-- ============================================================================
-- 끝
-- ============================================================================
