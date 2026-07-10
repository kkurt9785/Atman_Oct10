-- ============================================================================
-- ① get_nearby_open_shifts_v2 — 지역 칩 토글용 p_pref_labels 필터 추가
-- ② 워커 적립금 원장 (worker_credit_ledger) + 잔액 RPC
-- ③ 적립금 계좌 환급 신청 (credit_payout_requests) + 신청 RPC
-- ============================================================================

-- ── ① RPC 재정의 (파라미터 추가 = 시그니처 변경이라 DROP 필요) ─────────────
DROP FUNCTION IF EXISTS get_nearby_open_shifts_v2(uuid, text[], double precision, double precision);

CREATE OR REPLACE FUNCTION get_nearby_open_shifts_v2(
  p_auth_user_id uuid,
  p_roles text[],
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_pref_labels text[] DEFAULT NULL   -- NULL=전체 지역, []=지역 사용 안함, ['수원 팔달구']=해당 지역만
)
RETURNS TABLE (
  id uuid,
  facility_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  is_overnight boolean,
  required_role text,
  hourly_wage numeric,
  estimated_total_pay numeric,
  description text,
  department text,
  notes text,
  facility_name text,
  address_text text,
  distance_m double precision,
  matched_by text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH me AS (
  SELECT w.activity_center, COALESCE(w.activity_radius_meters, 12000)::double precision AS radius_m
  FROM workers w
  WHERE w.auth_user_id = p_auth_user_id
),
prefs AS (
  SELECT
    ST_SetSRID(ST_MakePoint((l->>'lng')::double precision, (l->>'lat')::double precision), 4326)::geography AS center,
    COALESCE((l->>'radius_km')::double precision, 12) * 1000 AS radius_m
  FROM worker_location_prefs p
  CROSS JOIN LATERAL jsonb_array_elements(p.locations) AS l
  WHERE p.worker_id = p_auth_user_id
    AND (l->>'lat') IS NOT NULL
    AND (l->>'lng') IS NOT NULL
    AND (p_pref_labels IS NULL OR l->>'label' = ANY (p_pref_labels))
),
centers AS (
  SELECT
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS center,
    12000::double precision AS radius_m,
    'gps'::text AS src
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
  UNION ALL
  SELECT center, radius_m, 'pref' FROM prefs
  UNION ALL
  SELECT m.activity_center, m.radius_m, 'fallback'
  FROM me m
  WHERE m.activity_center IS NOT NULL
    AND (p_lat IS NULL OR p_lng IS NULL)
    AND p_pref_labels IS NULL          -- 사용자가 지역을 명시적으로 껐다면 폴백도 안 씀
    AND NOT EXISTS (SELECT 1 FROM prefs)
)
SELECT
  s.id,
  s.facility_id,
  s.shift_date,
  s.start_time,
  s.end_time,
  s.is_overnight,
  s.required_role::text,
  s.hourly_wage::numeric,
  s.estimated_total_pay::numeric,
  s.description,
  s.department,
  s.notes,
  f.name AS facility_name,
  f.address_text,
  MIN(ST_Distance(f.location, c.center)) AS distance_m,
  (array_agg(c.src ORDER BY ST_Distance(f.location, c.center)))[1] AS matched_by
FROM shifts s
JOIN facilities f ON f.id = s.facility_id
JOIN centers c ON ST_DWithin(f.location, c.center, c.radius_m)
WHERE s.status::text = 'open'
  AND s.shift_date >= (timezone('Asia/Seoul', now()))::date
  AND s.required_role::text = ANY (p_roles)
GROUP BY
  s.id, s.facility_id, s.shift_date, s.start_time, s.end_time, s.is_overnight,
  s.required_role, s.hourly_wage, s.estimated_total_pay, s.description,
  s.department, s.notes, f.name, f.address_text
ORDER BY distance_m ASC, s.shift_date ASC;
$$;

GRANT EXECUTE ON FUNCTION get_nearby_open_shifts_v2(uuid, text[], double precision, double precision, text[]) TO authenticated;

-- ── ② 워커 적립금 원장 ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,                         -- 양수=적립, 음수=사용/환급
  kind TEXT NOT NULL CHECK (kind IN ('earn', 'spend', 'payout', 'adjust')),
  ref TEXT,                                       -- shift_id, 주문번호, payout_request_id 등
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wcl_worker ON worker_credit_ledger(worker_id, created_at DESC);

ALTER TABLE worker_credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wcl_own_select ON worker_credit_ledger;
CREATE POLICY wcl_own_select ON worker_credit_ledger FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
-- 쓰기는 service_role 전용 (적립/차감은 서버 로직만)

-- 잔액 조회
CREATE OR REPLACE FUNCTION get_my_credit_balance()
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(l.delta), 0)::integer
  FROM worker_credit_ledger l
  JOIN workers w ON w.id = l.worker_id
  WHERE w.auth_user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION get_my_credit_balance() TO authenticated;

-- ── ③ 환급 신청 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  bank_name TEXT,
  account_last4 TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cpr_worker ON credit_payout_requests(worker_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpr_pending ON credit_payout_requests(status) WHERE status = 'pending';

ALTER TABLE credit_payout_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cpr_own_select ON credit_payout_requests;
CREATE POLICY cpr_own_select ON credit_payout_requests FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
-- INSERT는 아래 RPC(SECURITY DEFINER)로만 — 잔액 검증을 강제하기 위함

-- 환급 신청 (잔액·대기중 신청 검증 포함)
CREATE OR REPLACE FUNCTION request_credit_payout(p_amount INTEGER)
RETURNS credit_payout_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_worker workers%ROWTYPE;
  v_balance INTEGER;
  v_pending INTEGER;
  v_bank RECORD;
  v_row credit_payout_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_worker FROM workers WHERE auth_user_id = auth.uid();
  IF v_worker.id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;
  IF p_amount < 1000 THEN RAISE EXCEPTION '최소 환급 금액은 1,000원이에요'; END IF;

  SELECT COALESCE(SUM(delta), 0) INTO v_balance FROM worker_credit_ledger WHERE worker_id = v_worker.id;
  SELECT COALESCE(SUM(amount), 0) INTO v_pending FROM credit_payout_requests WHERE worker_id = v_worker.id AND status = 'pending';
  IF p_amount > v_balance - v_pending THEN RAISE EXCEPTION '환급 가능 금액을 초과했어요'; END IF;

  SELECT bank_name, account_number_last4 INTO v_bank
  FROM worker_bank_accounts
  WHERE worker_id = v_worker.id AND is_primary = TRUE AND deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
  IF v_bank.bank_name IS NULL THEN RAISE EXCEPTION '등록된 계좌가 없어요. 계좌를 먼저 등록해주세요'; END IF;

  INSERT INTO credit_payout_requests (worker_id, amount, bank_name, account_last4)
  VALUES (v_worker.id, p_amount, v_bank.bank_name, v_bank.account_number_last4)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION request_credit_payout(INTEGER) TO authenticated;
