-- ============================================================================
-- 보안 강화 (운영 게이트)
--  ① RLS: FOR ALL 제거 → 작업별 분리, 워커 자기승인/근태위조 차단, workers INSERT 정책 신설
--  ② 동시성: 시프트당 accepted 1건 유니크, 정산 이중차감 방지 유니크
--  ③ checkout_and_settle: 정산 전체(임금계산·크레딧차감·상태변경·감사로그)를 단일 트랜잭션 RPC로
--  ④ 결제: payment_orders 주문 원장 + 멱등 승인 RPC
--  ⑤ Storage: license-photos 비공개 + 소유자 경로 정책
--  ⑥ RPC 사용자 식별: 클라이언트 파라미터 대신 auth.uid() 우선
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- ① RLS 재정비
-- ════════════════════════════════════════════════════════════════════════════

-- workers: INSERT 정책이 없어 온보딩 가입이 RLS에 막히던 문제 + UPDATE WITH CHECK
CREATE POLICY workers_insert_own ON workers FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());
DROP POLICY IF EXISTS workers_update_own ON workers;
CREATE POLICY workers_update_own ON workers FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- credentials: FOR ALL → 작업별
DROP POLICY IF EXISTS credentials_own ON worker_credentials;
CREATE POLICY credentials_select_own ON worker_credentials FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY credentials_insert_own ON worker_credentials FOR INSERT
  WITH CHECK (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY credentials_update_own ON worker_credentials FOR UPDATE
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()))
  WITH CHECK (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- bank_accounts: 직접 쓰기 차단 (쓰기는 upsert_my_bank_account RPC 전용) → SELECT만
DROP POLICY IF EXISTS bank_own ON worker_bank_accounts;
CREATE POLICY bank_select_own ON worker_bank_accounts FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- preferences / push_tokens: FOR ALL → 작업별 + WITH CHECK
DROP POLICY IF EXISTS preferences_own ON worker_preferences;
CREATE POLICY preferences_select_own ON worker_preferences FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY preferences_write_own ON worker_preferences FOR INSERT
  WITH CHECK (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY preferences_update_own ON worker_preferences FOR UPDATE
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()))
  WITH CHECK (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS push_own ON push_tokens;
CREATE POLICY push_select_own ON push_tokens FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY push_insert_own ON push_tokens FOR INSERT
  WITH CHECK (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY push_delete_own ON push_tokens FOR DELETE
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- ⚠️ applications: 기존 FOR ALL은 워커가 자기 지원을 'accepted'로 바꿀 수 있었음
DROP POLICY IF EXISTS applications_worker ON shift_applications;
CREATE POLICY applications_worker_select ON shift_applications FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));
CREATE POLICY applications_worker_insert ON shift_applications FOR INSERT
  WITH CHECK (
    worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid())
    AND status = 'applied'
  );
-- 워커 UPDATE는 취소만 가능 (수락/거절은 서버 전용)
CREATE POLICY applications_worker_cancel ON shift_applications FOR UPDATE
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()))
  WITH CHECK (
    worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid())
    AND status = 'cancelled'
  );

-- ⚠️ attendances: 기존 FOR ALL은 워커가 출퇴근 기록을 직접 생성/수정 가능했음 → 조회만
DROP POLICY IF EXISTS attendances_worker ON shift_attendances;
CREATE POLICY attendances_worker_select ON shift_attendances FOR SELECT
  USING (worker_id IN (SELECT id FROM workers WHERE auth_user_id = auth.uid()));

-- shifts: FOR ALL → 작업별 + WITH CHECK
DROP POLICY IF EXISTS shifts_facility_write ON shifts;
CREATE POLICY shifts_facility_insert ON shifts FOR INSERT
  WITH CHECK (facility_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid()));
CREATE POLICY shifts_facility_update ON shifts FOR UPDATE
  USING (facility_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid()))
  WITH CHECK (facility_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid()));
CREATE POLICY shifts_facility_delete ON shifts FOR DELETE
  USING (facility_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid()));

-- memberships: FOR ALL → 조회만 (변경은 서버 전용)
DROP POLICY IF EXISTS org_admin_memberships ON memberships;
CREATE POLICY org_admin_memberships_select ON memberships FOR SELECT
  USING (org_id IN (SELECT id FROM facilities WHERE admin_user_id = auth.uid()));

-- ════════════════════════════════════════════════════════════════════════════
-- ② 동시성·멱등성 제약
-- ════════════════════════════════════════════════════════════════════════════

-- 시프트당 수락 지원은 1건만 (동시 수락 레이스 DB 차단)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_accepted_application_per_shift
  ON shift_applications(shift_id) WHERE status = 'accepted';

-- 지원서당 출퇴근 기록 1건
CREATE UNIQUE INDEX IF NOT EXISTS uniq_attendance_per_application
  ON shift_attendances(application_id);

-- 정산(spend) 이중 차감 방지 — 같은 시프트 ref로 spend 1건만
CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_spend_per_ref
  ON credit_ledger(org_id, ref) WHERE kind = 'spend' AND ref IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ checkout_and_settle — 정산 단일 트랜잭션 (service_role에서 호출)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION checkout_and_settle(
  p_application_id uuid,
  p_facility_id uuid,               -- 서버가 쿠키+DB 재검증 후 전달 (신뢰 경계: 서버 액션)
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att shift_attendances%ROWTYPE;
  v_shift shifts%ROWTYPE;
  v_worker workers%ROWTYPE;
  v_now timestamptz := now();
  v_raw_min int;
  v_break_min int;
  v_worked_min int;
  v_night_min int;
  v_overtime_min int;
  v_per_min numeric;
  v_base int; v_ot int; v_night int; v_gross int;
  v_dist int;
  v_scan geography;
BEGIN
  -- 1. 행 잠금 (동시 스캔 직렬화)
  SELECT a.* INTO v_att
  FROM shift_attendances a
  WHERE a.application_id = p_application_id
  FOR UPDATE;

  IF v_att.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', '체크인 기록이 없어요');
  END IF;

  -- 2. 멱등성: 이미 체크아웃됐으면 그대로 반환
  IF v_att.check_out_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true,
      'gross', (SELECT gross FROM wage_calculations WHERE attendance_id = v_att.id));
  END IF;

  SELECT s.* INTO v_shift FROM shifts s WHERE s.id = v_att.shift_id;
  SELECT w.* INTO v_worker FROM workers w WHERE w.id = v_att.worker_id;

  -- 3. 권한: 이 병원의 시프트인지
  IF v_shift.facility_id IS DISTINCT FROM p_facility_id THEN
    RETURN jsonb_build_object('ok', false, 'message', '이 병원의 시프트가 아니에요');
  END IF;

  -- 4. 지오펜스 (좌표 제공 시): 병원 500m 밖 스캔 거부
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_scan := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
    v_dist := ST_Distance((SELECT location FROM facilities WHERE id = p_facility_id), v_scan)::int;
    IF v_dist > 500 THEN
      RETURN jsonb_build_object('ok', false,
        'message', format('병원에서 %s km 떨어진 위치예요. 병원 현장에서 스캔해주세요.', round(v_dist / 1000.0, 1)));
    END IF;
  END IF;

  -- 5. 근무시간·임금 계산 (2026-KR: 연장/야간 +50%, 휴게 차감)
  v_raw_min := GREATEST(0, round(EXTRACT(EPOCH FROM (v_now - v_att.check_in_at)) / 60))::int;
  v_break_min := CASE WHEN v_raw_min >= 480 THEN 60 WHEN v_raw_min >= 240 THEN 30 ELSE 0 END;
  v_worked_min := GREATEST(0, v_raw_min - v_break_min);
  v_overtime_min := GREATEST(0, v_worked_min - 480);

  -- 야간(KST 22~06) 분 계산
  SELECT COUNT(*)::int INTO v_night_min
  FROM generate_series(v_att.check_in_at, v_now - interval '1 minute', interval '1 minute') AS m
  WHERE EXTRACT(HOUR FROM (m AT TIME ZONE 'Asia/Seoul')) >= 22
     OR EXTRACT(HOUR FROM (m AT TIME ZONE 'Asia/Seoul')) < 6;
  v_night_min := LEAST(v_night_min, v_worked_min);

  v_per_min := v_shift.hourly_wage / 60.0;
  v_base  := round(v_worked_min * v_per_min);
  v_ot    := round(v_overtime_min * v_per_min * 0.5);
  v_night := round(v_night_min * v_per_min * 0.5);
  v_gross := v_base + v_ot + v_night;

  -- 6. 시설 크레딧 잔액 확인
  IF org_credit_balance(p_facility_id) < v_gross THEN
    RETURN jsonb_build_object('ok', false, 'message', '병원 크레딧이 부족해요. 충전 후 다시 시도해주세요.');
  END IF;

  -- 7. 원장·정산 기록 (실패 시 전체 롤백)
  INSERT INTO wage_calculations (
    attendance_id, org_id, worker_id, shift_id, rule_version,
    worked_minutes, night_minutes, overtime_minutes, break_minutes,
    base, overtime_premium, night_premium, holiday_premium, gross,
    breakdown, calculated_at
  ) VALUES (
    v_att.id, p_facility_id, v_att.worker_id, v_att.shift_id, '2026-KR',
    v_worked_min, v_night_min, v_overtime_min, v_break_min,
    v_base, v_ot, v_night, 0, v_gross,
    jsonb_build_object('hourly_wage', v_shift.hourly_wage, 'raw_minutes', v_raw_min, 'break_minutes', v_break_min),
    v_now
  );

  INSERT INTO credit_ledger (org_id, delta, kind, ref, created_at)
  VALUES (p_facility_id, -v_gross, 'spend', v_shift.id::text, v_now);

  -- 8. 출퇴근·지원·시프트 상태 확정
  UPDATE shift_attendances SET
    check_out_at = v_now,
    check_out_method = 'qr',
    check_out_location = v_scan,
    check_out_distance_m = v_dist
  WHERE id = v_att.id;

  UPDATE shift_applications SET checked_out_at = v_now, status = 'completed'
  WHERE id = p_application_id;

  UPDATE shifts SET status = 'completed' WHERE id = v_shift.id;

  -- 9. 감사 로그
  INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('facility', p_facility_id, 'attendance.checkout_settle', 'shift_attendance', v_att.id,
    jsonb_build_object('gross', v_gross, 'worked_min', v_worked_min, 'night_min', v_night_min,
                       'overtime_min', v_overtime_min, 'distance_m', v_dist));

  RETURN jsonb_build_object('ok', true, 'gross', v_gross,
    'worker_name', v_worker.name, 'shift_date', v_shift.shift_date, 'start_time', v_shift.start_time);
END;
$$;
-- service_role 전용: authenticated에 GRANT 하지 않음
REVOKE EXECUTE ON FUNCTION checkout_and_settle(uuid, uuid, double precision, double precision) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ④ 결제 주문 원장 + 멱등 승인
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_orders (
  order_id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  credit INTEGER NOT NULL,
  bonus INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  payment_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role 전용

-- 승인 후 크레딧 지급 (멱등: 이미 paid면 재지급 없이 반환)
CREATE OR REPLACE FUNCTION apply_payment_credit(
  p_order_id TEXT,
  p_payment_key TEXT,
  p_amount INTEGER
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order payment_orders%ROWTYPE;
  v_expires timestamptz := now() + interval '1 year';
BEGIN
  SELECT * INTO v_order FROM payment_orders WHERE order_id = p_order_id FOR UPDATE;
  IF v_order.order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', '주문을 찾을 수 없어요');
  END IF;
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'credited', v_order.credit);
  END IF;
  IF v_order.amount <> p_amount THEN
    RETURN jsonb_build_object('ok', false, 'message', '결제 금액이 주문과 달라요');
  END IF;

  INSERT INTO credit_ledger (org_id, delta, kind, ref, expires_at)
  VALUES (v_order.org_id, v_order.credit - v_order.bonus, 'earn', p_order_id, v_expires);
  IF v_order.bonus > 0 THEN
    INSERT INTO credit_ledger (org_id, delta, kind, ref, expires_at)
    VALUES (v_order.org_id, v_order.bonus, 'earn', p_order_id || ':bonus', v_expires);
  END IF;

  UPDATE payment_orders SET status = 'paid', payment_key = p_payment_key, paid_at = now()
  WHERE order_id = p_order_id;

  INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('facility', v_order.org_id, 'payment.credit_applied', 'payment_order', gen_random_uuid(),
    jsonb_build_object('order_id', p_order_id, 'amount', p_amount, 'credit', v_order.credit));

  RETURN jsonb_build_object('ok', true, 'credited', v_order.credit);
END;
$$;
REVOKE EXECUTE ON FUNCTION apply_payment_credit(TEXT, TEXT, INTEGER) FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ⑤ Storage: license-photos 비공개 + 소유자 경로 정책
-- ════════════════════════════════════════════════════════════════════════════

UPDATE storage.buckets SET public = false WHERE id = 'license-photos';

DROP POLICY IF EXISTS license_upload_own ON storage.objects;
CREATE POLICY license_upload_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'license-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS license_update_own ON storage.objects;
CREATE POLICY license_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'license-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS license_read_own ON storage.objects;
CREATE POLICY license_read_own ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'license-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
-- 관리자 열람은 서버(service_role)의 signed URL 발급으로만

-- ════════════════════════════════════════════════════════════════════════════
-- ⑥ RPC 사용자 식별 — auth.uid() 우선 (클라이언트 파라미터는 service_role 테스트용)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_nearby_open_shifts_v2(
  p_auth_user_id uuid,
  p_roles text[],
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_pref_labels text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid, facility_id uuid, shift_date date, start_time time, end_time time,
  is_overnight boolean, required_role text, hourly_wage numeric, estimated_total_pay numeric,
  description text, department text, notes text, facility_name text, address_text text,
  distance_m double precision, matched_by text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
WITH uid AS (
  SELECT COALESCE(auth.uid(), p_auth_user_id) AS v
),
me AS (
  SELECT w.activity_center, COALESCE(w.activity_radius_meters, 12000)::double precision AS radius_m
  FROM workers w WHERE w.auth_user_id = (SELECT v FROM uid)
),
prefs AS (
  SELECT
    ST_SetSRID(ST_MakePoint((l->>'lng')::double precision, (l->>'lat')::double precision), 4326)::geography AS center,
    COALESCE((l->>'radius_km')::double precision, 12) * 1000 AS radius_m
  FROM worker_location_prefs p
  CROSS JOIN LATERAL jsonb_array_elements(p.locations) AS l
  WHERE p.worker_id = (SELECT v FROM uid)
    AND (l->>'lat') IS NOT NULL AND (l->>'lng') IS NOT NULL
    AND (p_pref_labels IS NULL OR l->>'label' = ANY (p_pref_labels))
),
centers AS (
  SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS center,
         12000::double precision AS radius_m, 'gps'::text AS src
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
  UNION ALL
  SELECT center, radius_m, 'pref' FROM prefs
  UNION ALL
  SELECT m.activity_center, m.radius_m, 'fallback' FROM me m
  WHERE m.activity_center IS NOT NULL
    AND (p_lat IS NULL OR p_lng IS NULL)
    AND p_pref_labels IS NULL
    AND NOT EXISTS (SELECT 1 FROM prefs)
)
SELECT
  s.id, s.facility_id, s.shift_date, s.start_time, s.end_time, s.is_overnight,
  s.required_role::text, s.hourly_wage::numeric, s.estimated_total_pay::numeric,
  s.description, s.department, s.notes, f.name, f.address_text,
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
