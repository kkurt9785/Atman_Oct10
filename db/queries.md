# Atman — 핵심 쿼리 모음

스키마 사용 예시. 실제 앱·서버 코드에서 자주 호출할 쿼리.

---

## 1. 매칭: 시프트 공고 → 반경 내 워커 푸시

시설이 시프트를 올리면 활동지역 반경 안에 있는 승인된 워커 전원에게 푸시.

```sql
-- 함수 사용 (schema.sql에 정의됨)
SELECT * FROM find_workers_in_radius(
  (SELECT location FROM facilities WHERE id = $1),
  'rn',           -- 또는 'na', 'any'
  30000           -- 최대 30km
);
```

직접 쿼리 버전:

```sql
SELECT
  w.id AS worker_id,
  w.name,
  ST_Distance(w.activity_center, f.location)::INTEGER AS distance_m,
  pt.expo_token
FROM workers w
JOIN facilities f ON f.id = $1
LEFT JOIN push_tokens pt ON pt.worker_id = w.id AND pt.is_active = TRUE
LEFT JOIN worker_preferences wp ON wp.worker_id = w.id
WHERE w.verification_status = 'approved'
  AND w.deleted_at IS NULL
  AND w.role IN ('rn', 'na')
  AND ST_DWithin(w.activity_center, f.location, w.activity_radius_meters)
  AND (wp.min_hourly_wage IS NULL OR wp.min_hourly_wage <= $2)
  AND ($1 = ANY(wp.preferred_facility_ids) OR NOT ($1 = ANY(COALESCE(wp.excluded_facility_ids, '{}'))))
ORDER BY distance_m ASC
LIMIT 100;
```

---

## 2. 워커 홈: 내 근처 오픈 시프트 8건 (Approval 화면)

```sql
SELECT
  s.id,
  f.name AS facility_name,
  ST_Distance(f.location, w.activity_center)::INTEGER AS distance_m,
  s.shift_date,
  s.start_time,
  s.end_time,
  s.is_overnight,
  s.estimated_total_pay,
  s.night_premium_rate
FROM shifts s
JOIN facilities f ON f.id = s.facility_id
JOIN workers w ON w.id = $1
WHERE s.status = 'open'
  AND s.shift_date >= CURRENT_DATE
  AND (s.required_role = 'any' OR s.required_role = w.role)
  AND ST_DWithin(f.location, w.activity_center, w.activity_radius_meters)
  AND NOT EXISTS (
    SELECT 1 FROM shift_applications sa
    WHERE sa.shift_id = s.id AND sa.worker_id = w.id
  )
ORDER BY distance_m ASC
LIMIT 8;
```

---

## 3. 시프트 지원

```sql
INSERT INTO shift_applications (shift_id, worker_id, distance_meters)
VALUES (
  $1,  -- shift_id
  $2,  -- worker_id
  (SELECT ST_Distance(f.location, w.activity_center)::INTEGER
   FROM shifts s
   JOIN facilities f ON f.id = s.facility_id
   JOIN workers w ON w.id = $2
   WHERE s.id = $1)
);
```

---

## 4. 시설이 지원자 수락 (자동매칭일 수도 있음)

트랜잭션으로 처리.

```sql
BEGIN;

-- 지원 수락
UPDATE shift_applications
SET status = 'accepted', responded_at = NOW()
WHERE id = $1
RETURNING shift_id, worker_id;

-- 시프트 매칭
UPDATE shifts
SET status = 'matched',
    matched_worker_id = $2,
    matched_at = NOW()
WHERE id = (SELECT shift_id FROM shift_applications WHERE id = $1);

-- 같은 시프트의 다른 지원 자동 거절
UPDATE shift_applications
SET status = 'rejected', responded_at = NOW()
WHERE shift_id = (SELECT shift_id FROM shift_applications WHERE id = $1)
  AND id != $1
  AND status = 'applied';

COMMIT;
```

---

## 5. QR 퇴근 + 즉시 정산 트리거

```sql
BEGIN;

-- 퇴근 기록
UPDATE shift_attendances
SET check_out_at = NOW(),
    check_out_location = ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
    check_out_distance_m = ST_Distance(
      check_out_location,
      (SELECT location FROM facilities f
       JOIN shifts s ON s.facility_id = f.id WHERE s.id = shift_id)
    )::INTEGER,
    check_out_qr_nonce = $nonce,
    check_out_hmac_verified = TRUE,
    check_out_method = 'qr'
WHERE id = $1
RETURNING shift_id, worker_id, application_id, actual_minutes;

-- 시프트 완료
UPDATE shifts
SET status = 'completed'
WHERE id = (SELECT shift_id FROM shift_attendances WHERE id = $1);

-- 정산 생성 (3.3% 자동 공제)
WITH att AS (
  SELECT a.*, s.estimated_total_pay
  FROM shift_attendances a
  JOIN shifts s ON s.id = a.shift_id
  WHERE a.id = $1
), calc AS (
  SELECT * FROM calculate_settlement((SELECT estimated_total_pay FROM att))
)
INSERT INTO settlements (
  shift_id, worker_id, attendance_id, bank_account_id,
  gross_pay, platform_fee, income_tax, local_tax, net_pay,
  status
)
SELECT
  att.shift_id, att.worker_id, att.id,
  (SELECT id FROM worker_bank_accounts
   WHERE worker_id = att.worker_id AND is_primary = TRUE AND verified_at IS NOT NULL),
  att.estimated_total_pay,
  (att.estimated_total_pay * 0.12)::INTEGER,
  calc.income_tax, calc.local_tax, calc.net_pay,
  'pending'
FROM att, calc;

COMMIT;

-- 이후: 외부 핀테크 호출 (서버 코드) → 성공 시 status='paid', paid_at=NOW()
```

---

## 6. 워커 정산 내역 (최근 30일)

```sql
SELECT
  s.shift_date,
  f.name AS facility_name,
  s.start_time,
  s.end_time,
  st.gross_pay,
  st.tax_withheld,
  st.net_pay,
  st.status,
  st.paid_at
FROM settlements st
JOIN shifts s ON s.id = st.shift_id
JOIN facilities f ON f.id = s.facility_id
WHERE st.worker_id = $1
  AND st.created_at >= NOW() - INTERVAL '30 days'
ORDER BY st.created_at DESC;
```

---

## 7. 면허 만료 30일 전 알림 대상

크론으로 매일 새벽 실행.

```sql
SELECT
  c.id AS credential_id,
  c.worker_id,
  c.credential_type,
  c.expires_at,
  w.name,
  pt.expo_token
FROM worker_credentials c
JOIN workers w ON w.id = c.worker_id
LEFT JOIN push_tokens pt ON pt.worker_id = w.id AND pt.is_active = TRUE
WHERE c.verification_status = 'approved'
  AND c.expires_at IS NOT NULL
  AND c.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  AND w.deleted_at IS NULL;
```

---

## 8. 시설 평점 (Phase 2)

```sql
SELECT
  f.id,
  f.name,
  COUNT(r.id) AS review_count,
  ROUND(AVG(r.rating), 2) AS avg_rating,
  ROUND(AVG(r.punctuality), 2) AS avg_punctuality,
  ROUND(AVG(r.professionalism), 2) AS avg_professionalism,
  ROUND(AVG(r.environment), 2) AS avg_environment
FROM facilities f
LEFT JOIN shift_reviews r ON r.reviewee_facility_id = f.id
WHERE f.is_active = TRUE
GROUP BY f.id, f.name
ORDER BY avg_rating DESC NULLS LAST;
```

---

## 9. 계좌번호 암호화/복호화 패턴

```sql
-- INSERT 시
INSERT INTO worker_bank_accounts (
  worker_id, bank_code, bank_name,
  account_number_encrypted, account_number_last4,
  account_holder_name
) VALUES (
  $1, $2, $3,
  pgp_sym_encrypt($4, current_setting('app.encryption_key')),
  RIGHT($4, 4),
  $5
);

-- SELECT 시 (필요할 때만 복호화)
SELECT
  bank_name,
  account_number_last4,
  pgp_sym_decrypt(account_number_encrypted, current_setting('app.encryption_key')) AS account_number
FROM worker_bank_accounts
WHERE id = $1;
```

`app.encryption_key`는 Supabase Vault에 저장:
```sql
SELECT vault.create_secret('your-key-here', 'atman_encryption_key', 'Bank account encryption');
```

---

## 10. 야간 시프트 계산 검증

```sql
-- 야간수당 자동 적용 시 예상 급여
SELECT
  shift_date,
  start_time,
  end_time,
  is_overnight,
  hourly_wage,
  night_premium_rate,
  -- 단순 계산 (실제는 야간시간대만 가산)
  CASE
    WHEN is_overnight THEN
      hourly_wage * EXTRACT(HOUR FROM (end_time - start_time + INTERVAL '24 hours')) * night_premium_rate
    ELSE
      hourly_wage * EXTRACT(HOUR FROM (end_time - start_time))
  END AS calculated_total
FROM shifts
WHERE id = $1;
```

> ⚠️ 정확한 야간수당: 22:00~06:00 구간만 1.5배. 별도 함수로 분리 권장.

---

## 11. 활동지역 변경 (워커가 이사 등)

```sql
UPDATE workers
SET activity_center = ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
    activity_radius_meters = $radius,
    activity_address_text = $address
WHERE id = $1;

-- audit_log는 트리거로 자동 (별도 설정 필요)
```

---

## 12. 워커 탈퇴 (soft delete, 30일 보관)

```sql
BEGIN;

UPDATE workers
SET deleted_at = NOW(),
    expo_push_token = NULL
WHERE id = $1;

UPDATE push_tokens SET is_active = FALSE WHERE worker_id = $1;

-- 진행 중인 시프트가 있으면 차단해야 함 (어플리케이션 레이어)
-- 30일 후 크론으로 hard delete

COMMIT;
```

크론 (30일 후 완전 삭제):
```sql
DELETE FROM workers
WHERE deleted_at IS NOT NULL
  AND deleted_at < NOW() - INTERVAL '30 days';
```
