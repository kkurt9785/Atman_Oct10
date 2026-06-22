-- ============================================================================
-- 노무 본체 — 임금계산·임금대장·임금명세서 (C 단계, 유료 hr.* 기능)
-- 게이팅: 앱/Edge Function에서 org_has_feature(org,'hr.*') 확인 후 기록.
-- 근거: 포괄임금 금지(항목 분해) · 2026 임금대장 근로일별 시간 기재.
-- ============================================================================

-- 1) 임금 계산 결과 — 출퇴근 1건당 엔진(@itdat/wage-engine) 출력 저장
CREATE TABLE IF NOT EXISTS wage_calculations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id  UUID UNIQUE NOT NULL REFERENCES shift_attendances(id) ON DELETE CASCADE,
  org_id         UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  worker_id      UUID NOT NULL REFERENCES workers(id),
  shift_id       UUID NOT NULL REFERENCES shifts(id),
  rule_version   TEXT NOT NULL,                  -- 계산 당시 룰셋(분쟁 재현)
  worked_minutes   INTEGER NOT NULL,
  night_minutes    INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  break_minutes    INTEGER NOT NULL DEFAULT 0,
  base             INTEGER NOT NULL,
  overtime_premium INTEGER NOT NULL DEFAULT 0,
  night_premium    INTEGER NOT NULL DEFAULT 0,
  holiday_premium  INTEGER NOT NULL DEFAULT 0,
  gross            INTEGER NOT NULL,
  breakdown        JSONB,                         -- 엔진 전체 출력 스냅샷
  calculated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wagecalc_org_worker ON wage_calculations(org_id, worker_id);

-- 2) 임금대장 — 근로일별 연장·야간·휴일 시간 (2026 의무)
CREATE TABLE IF NOT EXISTS payroll_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  worker_id    UUID NOT NULL REFERENCES workers(id),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  work_date    DATE NOT NULL,
  worked_minutes   INTEGER NOT NULL,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  night_minutes    INTEGER NOT NULL DEFAULT 0,
  holiday_minutes  INTEGER NOT NULL DEFAULT 0,
  day_gross    INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, worker_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_ledger_period ON payroll_ledger(org_id, worker_id, period_start);

-- 3) 임금명세서 — 항목 분해 (포괄임금 금지 대응)
CREATE TABLE IF NOT EXISTS payslips (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  worker_id    UUID NOT NULL REFERENCES workers(id),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  total_worked_minutes   INTEGER NOT NULL,
  total_overtime_minutes INTEGER NOT NULL DEFAULT 0,
  total_night_minutes    INTEGER NOT NULL DEFAULT 0,
  total_holiday_minutes  INTEGER NOT NULL DEFAULT 0,
  base_pay           INTEGER NOT NULL,
  overtime_pay       INTEGER NOT NULL DEFAULT 0,
  night_pay          INTEGER NOT NULL DEFAULT 0,
  holiday_pay        INTEGER NOT NULL DEFAULT 0,
  weekly_holiday_pay INTEGER NOT NULL DEFAULT 0,
  gross_pay    INTEGER NOT NULL,
  income_tax   INTEGER NOT NULL DEFAULT 0,         -- 3.0%
  local_tax    INTEGER NOT NULL DEFAULT 0,         -- 소득세의 10%
  net_pay      INTEGER NOT NULL,
  rule_version TEXT NOT NULL,
  issued_at    TIMESTAMPTZ,
  pdf_url      TEXT,                                -- 발급 PDF(Storage)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, worker_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_payslips_worker ON payslips(worker_id);

-- ----------------------------------------------------------------------------
-- RLS — 사업장 관리자(전체) + 워커(본인 것 읽기). service_role 우회.
-- ----------------------------------------------------------------------------
ALTER TABLE wage_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_ledger    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['wage_calculations','payroll_ledger','payslips'] LOOP
    EXECUTE format($p$
      CREATE POLICY org_admin_%1$s ON %1$s FOR ALL USING (
        org_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid())
      );$p$, t);
    EXECUTE format($p$
      CREATE POLICY worker_read_%1$s ON %1$s FOR SELECT USING (
        worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid())
      );$p$, t);
  END LOOP;
END $$;
