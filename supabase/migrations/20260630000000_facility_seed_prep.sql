-- 병원 시딩 준비: business_registration_number nullable 허용
-- 사전 시딩 병원은 사업자번호 미확인 상태로 넣고 나중에 병원이 가입 시 업데이트
ALTER TABLE facilities
  ALTER COLUMN business_registration_number DROP NOT NULL;

-- contact_email, contact_name, contact_phone 도 nullable 허용 (시딩용)
ALTER TABLE facilities
  ALTER COLUMN contact_email DROP NOT NULL;

ALTER TABLE facilities
  ALTER COLUMN contact_name DROP NOT NULL;

ALTER TABLE facilities
  ALTER COLUMN contact_phone DROP NOT NULL;

-- 관리자가 병원 찾기에서 선택 후 연결하는 인덱스
CREATE INDEX IF NOT EXISTS idx_facilities_unclaimed
  ON facilities(admin_user_id)
  WHERE admin_user_id IS NULL AND deleted_at IS NULL;

-- 병원명 검색용 인덱스
CREATE INDEX IF NOT EXISTS idx_facilities_name
  ON facilities USING gin(to_tsvector('simple', name));
