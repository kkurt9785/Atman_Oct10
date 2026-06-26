-- ============================================================================
-- worker_location_prefs — 워커 시프트 알림 지역 설정 (최대 2개)
-- locations: [{ label, radius_km }, ...]
-- ============================================================================

CREATE TABLE IF NOT EXISTS worker_location_prefs (
  worker_id  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  locations  JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER worker_location_prefs_updated_at
  BEFORE UPDATE ON worker_location_prefs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE worker_location_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "location_prefs: 본인 전체" ON worker_location_prefs
  FOR ALL USING (auth.uid() = worker_id);
