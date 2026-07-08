-- Facility profile fields for worker-facing Bottom Sheet
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS bed_count       INT,
  ADD COLUMN IF NOT EXISTS main_department TEXT,
  ADD COLUMN IF NOT EXISTS has_parking     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_meals       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_uniform     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS emr_system      TEXT,
  ADD COLUMN IF NOT EXISTS intro           TEXT;

COMMENT ON COLUMN facilities.bed_count       IS '병상 수';
COMMENT ON COLUMN facilities.main_department IS '주 병동 (예: 요양병동, 재활병동)';
COMMENT ON COLUMN facilities.has_parking     IS '주차 가능 여부';
COMMENT ON COLUMN facilities.has_meals       IS '식사 제공 여부';
COMMENT ON COLUMN facilities.has_uniform     IS '유니폼 제공 여부';
COMMENT ON COLUMN facilities.emr_system      IS 'EMR 시스템 명칭';
COMMENT ON COLUMN facilities.intro           IS '병원 소개글 (AI 생성 가능)';
