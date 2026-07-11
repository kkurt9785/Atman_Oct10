# 로컬 검증 가이드

## 1. 압축 해제와 무결성

```bash
unzip Atman_P0_hardened_source_2026-07-11.zip -d Atman_P0_hardened
cd Atman_P0_hardened
find . -name '.env*' -not -name '.env.local.example' -print
find . -type d \( -name node_modules -o -name .next -o -name .git \) -print
```

실제 secret `.env`, `node_modules`, `.next`, `.git`이 없어야 한다.

## 2. 관리자 웹

```bash
cd apps/admin-web
cp .env.local.example .env.local
# placeholder를 스테이징 값으로 교체
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm run build
```

## 3. 워커 웹

```bash
cd ../worker-web
cp .env.local.example .env.local
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm run build
```

## 4. 급여 엔진

```bash
cd ../../packages/wage-engine
npm test
```

## 5. SQL 정적 검증

Supabase CLI가 있는 환경:

```bash
supabase start
supabase db reset
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/p0_schema_assertions.sql
```

CLI 없이 parser만 확인하는 것은 SQL 실행 검증을 대체하지 않는다.

## 6. 권한 공격 테스트

- 워커 A JWT로 워커 B의 worker, bank, license, application, attendance를 직접 조회/수정
- 일반 시설 관리자로 전체 pending worker 면허 조회
- 다른 시설 ID로 accept/reject/QR consume/payment order 조회
- 브라우저에서 service-role key 검색
- private bucket object URL에 익명·타 사용자 JWT로 접근

모두 거부되어야 한다.

## 7. 동시성 테스트

- 같은 shift의 마지막 정원에 20개 accept 요청
- 같은 QR token에 20개 consume 요청
- 같은 checkout에 20개 요청
- 같은 Toss success callback에 20개 요청

각 케이스에서 상태 전이와 금액 원장 기록은 한 번만 발생해야 한다.

## 8. Claude/GPT 코드 재검토 프롬프트

```text
첨부한 Atman 프로젝트를 출시 전 감사해줘.
우선순위는 Supabase RLS/GRANT/SECURITY DEFINER, 관리자 세션과 시설 역할,
지원 수락 동시성, QR replay, 체크아웃·임금·크레딧 원자성, Toss 주문·승인·웹훅·재조정,
private Storage, 온보딩 rollback, push outbox, 급여 규칙이다.

코드에서 실제 근거가 있는 항목만 보고하고 각 발견에 파일:라인, 공격/재현 방법,
영향, 수정안, 회귀 테스트를 포함해줘. SQL parser 통과를 DB 실행 통과로 간주하지 말고,
스테이징에 적용되지 않은 migration과 법률/운영 문서는 출시 완료로 평가하지 마.
```
