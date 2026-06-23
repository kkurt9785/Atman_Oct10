-- ============================================================================
-- 멤버십 + 크레딧 (지속형 retention 모델)
--   오늘의집式 "회비 즉시 페이백"을 일회성→주기형으로 커스텀:
--   ① 가입 즉시 페이백(장벽 0) ② 매 주기 '활동 시 회비 재페이백'(계속 써야 이득)
--   ③ 크레딧 유효기간 소멸(손실회피) ④ 등급/연속이용 ⑤ 크레딧은 fee에만 사용
--   결제 주체 = 사장님(org=facilities). 회비·적립률·기준은 tier 데이터로 튜닝.
-- ============================================================================

-- 1) 등급(tier) — 회비·적립률·페이백 조건을 데이터로 (코드 무수정 튜닝)
CREATE TABLE IF NOT EXISTS membership_tiers (
  code                 TEXT PRIMARY KEY,        -- 'basic','pro'
  name                 TEXT NOT NULL,
  monthly_fee          INTEGER NOT NULL,        -- 주기 회비(원)
  earn_rate            NUMERIC(4,3) NOT NULL,   -- 결제 적립률
  payback_threshold    INTEGER NOT NULL,        -- 이 주기 사용액 ≥ 기준 → 회비 재페이백
  credit_validity_days INTEGER NOT NULL DEFAULT 90, -- 적립 크레딧 유효기간
  grants_plan_code     TEXT REFERENCES plans(code), -- 부여 기능(통합 등)
  sort_order           INTEGER DEFAULT 0
);

INSERT INTO membership_tiers (code, name, monthly_fee, earn_rate, payback_threshold, credit_validity_days, grants_plan_code, sort_order) VALUES
  ('basic', '베이직', 9900, 0.030, 100000, 90, 'bundle', 1),
  ('pro',   '프로',  19900, 0.050, 300000, 90, 'bundle', 2)
ON CONFLICT (code) DO NOTHING;

-- 2) 멤버십 — 주기형(월) 구독. 현재 주기·연속이용 추적.
CREATE TABLE IF NOT EXISTS memberships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  tier_code           TEXT NOT NULL REFERENCES membership_tiers(code),
  auto_renew          BOOLEAN NOT NULL DEFAULT TRUE,
  cycle_days          INTEGER NOT NULL DEFAULT 30,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ NOT NULL,
  consecutive_cycles  INTEGER NOT NULL DEFAULT 1, -- 연속 이용 주기 수(등급/혜택용)
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','canceled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_active_org
  ON memberships(org_id) WHERE status = 'active';

-- 3) 크레딧 원장 (append-only). 잔액 = 미소멸 delta 합.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,                  -- +적립 / -사용
  kind       TEXT NOT NULL CHECK (kind IN (
               'signup_payback',  -- 가입 즉시 회비 페이백(1회)
               'cycle_payback',   -- 주기 활동 시 회비 재페이백(반복)
               'earn',            -- 결제 적립
               'spend',           -- 수수료·구독에 사용
               'expire','adjust')),
  ref        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ                        -- 유효기간(지나면 잔액 자동 제외)
);
CREATE INDEX IF NOT EXISTS idx_credit_org ON credit_ledger(org_id);

CREATE OR REPLACE FUNCTION org_credit_balance(p_org_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(delta), 0)::INTEGER FROM credit_ledger
  WHERE org_id = p_org_id AND (expires_at IS NULL OR expires_at > NOW());
$$;

-- 4) entitlement 부여 헬퍼 (멤버십 주기 동안 기능 열기)
CREATE OR REPLACE FUNCTION grant_membership_entitlements(p_org_id UUID, p_plan_code TEXT, p_until TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO entitlements (org_id, feature_key, granted_until)
  SELECT p_org_id, pf.feature_key, p_until FROM plan_features pf WHERE pf.plan_code = p_plan_code
  ON CONFLICT (org_id, feature_key) DO UPDATE SET granted_until = EXCLUDED.granted_until;
  UPDATE facilities SET plan_code = p_plan_code WHERE id = p_org_id;
END $$;

-- 5) 가입 — 멤버십 시작 + 첫 주기 회비 즉시 페이백(장벽 0) + 기능 부여
CREATE OR REPLACE FUNCTION start_membership(p_org_id UUID, p_tier_code TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE m_id UUID; t membership_tiers%ROWTYPE; v_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO t FROM membership_tiers WHERE code = p_tier_code;
  v_end := NOW() + INTERVAL '30 days';
  INSERT INTO memberships (org_id, tier_code, current_period_end)
  VALUES (p_org_id, p_tier_code, v_end) RETURNING id INTO m_id;

  INSERT INTO credit_ledger (org_id, delta, kind, ref, expires_at)
  VALUES (p_org_id, t.monthly_fee, 'signup_payback', m_id::TEXT, NOW() + (t.credit_validity_days || ' days')::INTERVAL);

  PERFORM grant_membership_entitlements(p_org_id, t.grants_plan_code, v_end);
  RETURN m_id;
END $$;

-- 6) 주기 마감 — 핵심 지속 장치
--    이번 주기 사용액(p_period_usage)이 기준 이상이면 "회비 재페이백" → 계속 써야 이득.
--    + 주기 롤오버 + 연속이용 +1 + 기능 연장. (크레딧 소멸은 잔액함수가 자동 처리)
CREATE OR REPLACE FUNCTION close_membership_cycle(p_membership_id UUID, p_period_usage INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE mem memberships%ROWTYPE; t membership_tiers%ROWTYPE; paid BOOLEAN := FALSE; v_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO mem FROM memberships WHERE id = p_membership_id AND status = 'active';
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT * INTO t FROM membership_tiers WHERE code = mem.tier_code;

  IF p_period_usage >= t.payback_threshold THEN
    INSERT INTO credit_ledger (org_id, delta, kind, ref, expires_at)
    VALUES (mem.org_id, t.monthly_fee, 'cycle_payback', p_membership_id::TEXT,
            NOW() + (t.credit_validity_days || ' days')::INTERVAL);
    paid := TRUE;
  END IF;

  IF mem.auto_renew THEN
    v_end := mem.current_period_end + (mem.cycle_days || ' days')::INTERVAL;
    UPDATE memberships SET
      current_period_start = mem.current_period_end,
      current_period_end   = v_end,
      consecutive_cycles   = mem.consecutive_cycles + 1
    WHERE id = p_membership_id;
    PERFORM grant_membership_entitlements(mem.org_id, t.grants_plan_code, v_end);
  END IF;
  RETURN paid;
END $$;

-- 7) RLS
ALTER TABLE memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_admin_memberships ON memberships FOR ALL USING (
  org_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid()));
CREATE POLICY org_admin_credit ON credit_ledger FOR SELECT USING (
  org_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid()));
CREATE POLICY public_read_tiers ON membership_tiers FOR SELECT USING (TRUE);
