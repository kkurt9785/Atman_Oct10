# Atman Supabase 운영 지침

> 기준 코드: P0 hardening 패치 · 작성일: 2026-07-11
> 적용 범위: 관리자 웹, 워커 웹, Auth, Postgres/RLS/RPC, Storage, 출퇴근·정산, 결제·크레딧, 푸시, 온보딩

## 1. 운영 원칙

1. 브라우저는 `anon/publishable key + 사용자 JWT`만 사용한다.
2. `service_role`은 결제 승인·웹훅·알림 outbox·운영자 심사처럼 신뢰된 서버 작업에만 사용한다.
3. 사용자가 전달한 `user_id`, `worker_id`, `facility_id`, 직군·역할을 권한 근거로 사용하지 않는다. DB 함수 안에서 `auth.uid()`와 관계 테이블로 다시 계산한다.
4. 돈·근태·매칭 상태가 함께 바뀌는 작업은 PostgreSQL RPC 한 트랜잭션으로 처리한다.
5. 면허·계좌 등 민감정보는 private Storage/RLS/암호화/감사 로그를 적용한다.
6. 개발, 스테이징, 운영 Supabase 프로젝트를 분리한다. 운영 DB에 seed·demo 계정·demo cron을 남기지 않는다.

## 2. 키와 환경변수

### 관리자 웹

```dotenv
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-secret>
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-key>
FACILITY_COOKIE_SECRET=<32바이트 이상 무작위 문자열>
TOSS_SECRET_KEY=<server-secret>
NEXT_PUBLIC_TOSS_CLIENT_KEY=<browser-key>
TOSS_WEBHOOK_TOKEN=<24자 이상 무작위 문자열>
CRON_SECRET=<무작위 문자열>
VAPID_SUBJECT=mailto:security@example.com
VAPID_PUBLIC_KEY=<public-key>
VAPID_PRIVATE_KEY=<server-secret>
NEXT_PUBLIC_ENABLE_DEMO_LOGIN=0
```

### 워커 웹

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-key>
NEXT_PUBLIC_KAKAO_REST_API_KEY=<public-client-id>
KAKAO_REST_API_KEY=<server-client-id>
KAKAO_CLIENT_SECRET=<server-secret>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public-key>
NEXT_PUBLIC_ENABLE_DEMO_LOGIN=0
```

`SUPABASE_SERVICE_ROLE_KEY`, `TOSS_SECRET_KEY`, `VAPID_PRIVATE_KEY`, `KAKAO_CLIENT_SECRET`, `FACILITY_COOKIE_SECRET`, `CRON_SECRET`은 브라우저 번들에 들어가면 안 된다. `NEXT_PUBLIC_` 접두사를 붙이지 않는다.

## 3. Auth와 관리자 권한

관리자 요청은 다음 순서로 검증한다.

```text
HttpOnly admin session cookie
  → Supabase Auth getUser(access token)
  → profiles.role = admin
  → 서명된 facility context가 같은 userId에 묶였는지 확인
  → facilities.admin_user_id 또는 facility_admin_access 역할 재조회
  → 요청별 허용 역할 확인
```

시설 쿠키는 시설 선택 상태일 뿐 독립적인 인증 수단이 아니다. 로그아웃 시 관리자 세션 쿠키와 시설 context 쿠키를 모두 삭제한다. 면허 전체 심사는 플랫폼 `super`만 수행하고, 일반 시설 관리자는 자기 시설 지원자 범위만 확인한다.

## 4. RLS 기준

- 핵심 테이블에 `FOR ALL` 정책을 만들지 않는다.
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` 정책을 분리한다.
- 직접 쓰기가 비즈니스 규칙을 우회할 수 있는 테이블은 browser role의 쓰기 권한을 `REVOKE`하고 RPC만 허용한다.
- `SECURITY DEFINER` 함수는 `SET search_path = ''`와 완전 수식된 테이블명을 사용한다.
- 함수 생성 후 `REVOKE ALL ... FROM PUBLIC`을 먼저 수행하고 필요한 역할에만 `GRANT EXECUTE`한다.

RPC 전용 핵심 테이블:

```text
shift_applications
shift_attendances
wage_calculations
payroll_ledger
settlements
payment_orders
credit_ledger
worker_credit_ledger
credit_payout_requests
worker_bank_accounts
notification_outbox
attendance_audit
```

적용 후 `supabase/tests/p0_schema_assertions.sql`을 실행해 정책·권한을 검증한다.

## 5. 마이그레이션 순서

파일명 정렬 순서로 전체 마이그레이션을 스테이징에 적용한다. P0 패치는 다음 네 파일이다.

```text
20260710230000_p0_security_and_onboarding.sql
20260710231000_p0_shift_attendance_settlement.sql
20260710232000_p0_payment_credit_push.sql
20260710233000_p0_release_gate.sql
```

적용 절차:

```bash
supabase link --project-ref <staging-project-ref>
supabase db push --dry-run
supabase db push
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/p0_schema_assertions.sql
```

운영 적용 전 스테이징 DB 백업과 마이그레이션 rollback 계획을 기록한다. 이미 적용한 migration 파일은 수정하지 않고 후속 migration으로 교정한다. 이번 전달본은 아직 운영에 적용되지 않은 소스 기준이므로 새 P0 파일을 한 묶음으로 검토해야 한다.

## 6. 계좌 암호화

계좌번호 암호화 키가 없으면 저장 작업은 반드시 실패해야 한다. 기본키·demo 키로 대체하지 않는다.

권장 설정:

```sql
-- Supabase Vault 또는 운영 전용 DB 설정으로 저장한다.
-- 실제 명령은 프로젝트의 Vault 운영 절차에 맞춰 실행한다.
SELECT vault.create_secret('<strong-random-secret>', 'bank_encryption_key');
```

검증 항목:

- 운영·스테이징 키를 분리한다.
- 키는 Git, SQL migration, 로그에 기록하지 않는다.
- 복호화는 본인 계좌 확인 또는 승인된 지급 서버 작업으로 제한한다.
- UI에는 마지막 4자리만 반환한다.
- 키 교체 절차와 기존 데이터 재암호화 계획을 별도 운영 문서로 둔다.

## 7. 면허 Storage

`license-photos` bucket은 private이어야 한다.

```text
업로드 경로: <auth.uid()>/<random-uuid>.<ext>
업로드 주체: 해당 사용자만
열람: 사용자 본인 또는 승인된 심사 서버
공유: 1~5분 signed URL
제한: image/jpeg, image/png, image/webp 및 크기 상한
```

`getPublicUrl()`을 사용하지 않는다. signed URL을 로그·DB 영구 필드에 저장하지 않는다. DB에는 object path만 저장한다.

## 8. 온보딩

`complete_worker_onboarding` 한 번으로 다음을 원자적으로 처리한다.

```text
입력 검증
→ workers upsert
→ 활동지역 저장
→ private 면허 object 존재 확인
→ credential 기록
→ 계좌 암호화 저장
→ 버전이 포함된 동의 이력 저장
→ profiles.onboarding_done
→ draft 제거
→ audit log
```

필수 검증:

- 만 18세 이상과 생년월일 범위
- 휴대폰 형식
- 직군 enum
- 활동지역 1~2개, 좌표·반경 범위
- 면허 object path의 첫 segment가 `auth.uid()`인지
- 필수 약관 종류와 version
- 계좌번호·예금주·은행코드

어느 단계든 실패하면 전체 transaction을 rollback한다. 클라이언트는 실패 시 업로드한 미사용 object를 삭제하도록 시도하되, 별도 정리 job도 운영한다.

## 9. 시프트·지원·수락

- 검색 RPC는 직군과 worker ID를 인자로 받지 않고 `auth.uid()`로 결정한다.
- 지원은 `apply_to_shift`만 사용한다.
- 수락은 대상 shift/application row를 잠근 뒤 정원·상태·중복 확정 근무를 검사한다.
- 지원 취소·거절도 상태 전이를 RPC에서 제한한다.
- 프론트의 비활성 버튼은 UX일 뿐 무결성 수단이 아니다.

동시 수락 테스트는 최소 20개 병렬 요청으로 수행해 한 건만 성공하는지 확인한다.

## 10. 일회용 QR과 출퇴근

QR에는 내부 ID를 직접 넣지 않는다.

```json
{
  "type": "attendance_challenge",
  "token": "<random bearer token>"
}
```

서버는 원문 token을 한 번만 반환하고 DB에는 해시만 저장한다. 발급 시 해당 워커·확정 지원·근무일을 검증한다. 소비 시 token row를 `FOR UPDATE`로 잠근 후 다음을 검증한다.

- 만료 60초 이내
- `consumed_at IS NULL`
- 스캔 관리자에게 해당 시설 권한이 있음
- application/shift/attendance 상태가 유효함
- 시설이 지오펜스를 요구하면 GPS가 존재하고 반경 이내임

성공한 transaction 안에서 `consumed_at`을 기록한다. 같은 QR에 대한 동시 요청은 한 요청만 성공해야 한다.

## 11. 체크아웃·임금·정산·크레딧

`consume_attendance_qr`의 체크아웃 경로에서 한 transaction으로 처리한다.

```text
근태 행 잠금
→ 최소 근무시간·상태 검증
→ 규칙 버전 기반 임금 계산
→ 플랫폼 수수료 계산
→ 시설 잔액 잠금/검증
→ credit_ledger 차감
→ wage_calculations / payroll_ledger / settlement 기록
→ attendance/application/shift 완료 전이
→ worker credit 적립
→ audit/outbox 기록
→ commit
```

임금 계산 엔진의 결과와 DB 계산 규칙은 같은 규칙 버전을 사용해야 한다. 경계값 테스트에는 자정 통과, 22:00~06:00 야간, 8시간 초과, 휴게시간, DST 비적용 KST, 중복 체크아웃을 포함한다.

## 12. 토스 결제

신뢰 경계는 provider 재조회 결과와 서버 주문 원장이다.

```text
관리자 권한 검증
→ 서버가 payment_orders 생성
→ 브라우저가 Toss UI 호출
→ success callback에서 서버 승인
→ orderId/paymentKey/amount 일치 검증
→ finalize_credit_payment RPC
→ base/bonus credit 멱등 적립
```

필수 운영 경로:

- 결제 승인 POST에 주문별 Idempotency-Key
- webhook body를 정산 권한으로 신뢰하지 않고 paymentKey로 provider 재조회
- 브라우저가 닫히거나 callback이 유실돼도 `reconcile-payments` cron이 `confirming/reconcile_required` 주문을 복구
- 결제 성공과 크레딧 적립 사이 실패는 같은 주문을 재처리해 한 번만 적립
- 취소·부분취소는 자동 원장 역분개 전에 사용된 크레딧을 검토하고 운영자 reconciliation 대상으로 보냄

운영 전 Toss 테스트 키로 성공, 중복 callback, timeout, 승인 성공 후 로컬 실패, webhook 중복, 취소·부분취소를 검증한다.

## 13. 푸시 outbox

비즈니스 transaction은 직접 외부 push API를 호출하지 않고 `notification_outbox`에 이벤트를 넣는다. cron은 잠금 가능한 행을 claim하고 발송 결과를 `sent`, `failed`, `discarded`로 완료한다.

- 404/410 subscription은 삭제한다.
- 일시 실패는 retry count/next attempt 기준으로 재시도한다.
- 동일 이벤트의 멱등 key를 유지한다.
- VAPID 미설정 시 성공으로 기록하지 않는다.

## 14. 데모 데이터 제거

운영 배포 직전에 자동 migration이 아니라 사람이 검토하는 수동 스크립트로 수행한다.

```sql
BEGIN;
SET LOCAL app.environment = 'production';
SET LOCAL app.confirm_demo_cleanup = 'YES';
\i scripts/prepare-production.sql
COMMIT;
```

그리고 양쪽 배포 환경에서 `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=0`을 확인한다.

## 15. 백업·복구·관측성

- Production은 최소 일별 백업과 복구 목표를 정의한다.
- PITR 사용 여부와 보존 기간을 문서화한다.
- 출시 전 스테이징 복구 리허설을 수행한다.
- 결제 order ID, RPC idempotency key, audit entity ID는 로그에서 상호 추적 가능해야 한다.
- 계좌번호, access token, 면허 signed URL, Toss secret, provider 전체 민감 payload는 로그에 남기지 않는다.
- 오류율, payment reconciliation 대기 건수, outbox 실패, QR 거부 사유, RLS 401/403을 모니터링한다.

## 16. 출시 게이트

운영 출시 전 다음 조건이 모두 충족되어야 한다.

- 스테이징 migration 전체 적용 성공
- `p0_schema_assertions.sql` 통과
- OWNER/OPERATOR/SALES/SUPER/WORKER 권한 공격 테스트 통과
- 지원 수락·QR 소비·체크아웃 20개 병렬 테스트 통과
- private 면허 object의 익명/타인 접근 차단 확인
- Toss sandbox 복구·중복·webhook 테스트 통과
- demo 계정/cron 제거 확인
- 백업 복구 리허설 완료
- 개인정보·위치·직업소개·결제/환불 약관 최종 검토

이 문서와 코드 검증만으로 운영 출시가 승인되는 것은 아니다. 실제 Supabase 스테이징 프로젝트에 마이그레이션을 적용하고 데이터베이스·브라우저·결제 제공자 통합 테스트를 통과해야 한다.
