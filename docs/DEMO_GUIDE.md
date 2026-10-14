# 잇닿 시연 가이드

> 최종 업데이트: 2026-08-04 · 병원·약국 영업 데모 운영 절차

## 1. 계정

| 용도 | 계정 | 비고 |
|---|---|---|
| 병원 관리자 | sales-demo-**1**@demo.atman.co.kr | W여성병원(**광주 광산구**) · super · 근무자 짝은 worker-demo-1(광주 RN) → 공고는 **간호사(RN)**로 |
| 약국 관리자 | sales-demo-**2**@demo.atman.co.kr | 수원 온누리 데모약국 · super · 근무자 짝은 worker-demo-6(약사) |
| 요양병원 관리자 | sales-demo-**3**@demo.atman.co.kr | 수원요양병원 · super · 근무자 짝은 worker-demo-5(수원 영통 NA) → 공고는 **간호조무사(NA)**로 |
| 워커 (광주 RN) | worker-demo-**1**@demo.atman.co.kr | 광주 광산구 병원 미팅용 |
| 약국 직원 (박하늘·전산/접수) | worker-demo-**2** | 온누리약국 출퇴근·휴가·근태 캘린더 |
| 워커 (수원 권선 NA) | worker-demo-**3** | |
| 워커 (수원 팔달 RN) | worker-demo-**4** | |
| 워커 (수원 영통 NA) | worker-demo-**5** | |
| 약사 (김서현) | worker-demo-**6** | 대체약사 공고 조회·지원 |

비밀번호 공통: `Atman-demo-2026!`

> 세 관리자 계정은 `apps/admin-web/lib/demo/revive-showcase.ts`가 매일 아침 **전부 super**로 되돌린다(sales·operator 시연 계정은 없음). 공고는 지역이 맞는 근무자 짝에게만 보인다 — 병원(광주)에서 올린 공고는 수원 조무사 시연에 안 뜬다(2026-10-14 QA).

데모 로그인 버튼은 `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=1`일 때 노출된다. **2026-10 현재 운영(admin.itdot.co.kr·itdot.co.kr)에도 켜져 있다**(공개 시연 입구). 끄려면 두 Vercel 프로젝트의 환경변수를 바꾸고 다시 배포.

## 2. 시연 전날 (또는 당일 아침)

```bash
cd ~/atman
python3 scripts/revive_demo.py
```

생성 내용: 오늘 날짜 시프트 100건 (근무중 50 + 모집 50) · **지원 대기 150건** (모집 시프트당 지원자 3명, 직군 일치) · 병원별 근태관리 직원 5명(근무중·퇴근·지각·조기퇴근 대기·휴가) · 슈퍼계정/권한 재보증.

최초 1회만: `python3 scripts/setup_demo_worker_accounts.py` (워커 계정 6개 — 재실행해도 안전)

## 3. 로컬 구동

```bash
cd ~/atman/apps/admin-web && npm run dev    # localhost:3002
cd ~/atman/apps/worker-web && npm run dev   # localhost:3003
```

## 4. 풀사이클 시나리오 (~5분)

1. **워커 화면** (`:3003`, 폰 미러링 권장): 지역에 맞는 worker-demo 계정 로그인 → 홈에서 GPS/지역 칩 + 거리순 시프트 → **지원**
2. **관리자 화면** (`:3002`): 슈퍼계정 1 로그인 → 병원 전환 드롭다운(50개) → 지원 현황: **지원자 3명 프로필 비교 → 수락** → 워커 폰에 푸시 도착
3. **워커**: 내 활동 → **QR 표시** — "45초마다 회전, 캡처본 무효" 멘트
4. **관리자**: QR 체크인 스캔 → (시간 경과 가정) → 재스캔 **체크아웃**
5. **클라이맥스**: 그 자리에서 임금(연장·야간 가산 자동 분리) + 수수료 + 크레딧 차감이 한 번에 정산 → 급여명세 화면 마무리. "2026 포괄임금 금지 대응" 강조
6. **병원 근태관리**: 직원 관리 → 오늘 근태에서 근무중·퇴근·지각 확인 → 조기퇴근 승인/반려 → 휴가에서 반차 신청 승인/반려 → 직원 QR 인쇄 화면 확인
7. **약국 확장 시연**: 사업장 전환에서 `수원 온누리 데모약국` 선택 → demo-2 박하늘의 출퇴근·휴가·월 근태 확인 → demo-6 김서현의 대체약사 공고 지원 확인

## 5. 주의사항

- **위치 권한**: 원격 시연이면 관리자 기기에서 위치 권한 **거부** — 데모 병원은 지오펜스 필수가 해제돼 있어 통과됩니다. (병원 현장 시연이면 허용해도 됨 — 500m 이내)
- **QR 발급 시간창**: 근무 시작 4시간 전 ~ 종료 6시간 후에만 발급됩니다. revive 스크립트가 오늘 시프트를 만들므로 낮 시연은 문제없음
- 시프트는 당일 자정(KST) 지나면 만료 → 다음 시연 전 revive 재실행
- 데모 워커 체크아웃 정산은 데모 병원 크레딧에서 차감됨 (진짜 돈 아님)

## 6. 관련 스크립트

| 파일 | 역할 |
|---|---|
| `scripts/revive_demo.py` | 시프트·지원·근무 데이터 재생성 (시연 전날 실행) |
| `scripts/setup_demo_worker_accounts.py` | 워커 데모 계정 6개 + 계좌 + 지오펜스 해제 (1회) |
| `supabase/prod_demo_teardown.sql` | 데모 정리 (실서비스 전환 시) |

## 시연 때 걸리기 쉬운 것 (2026-10-14 QA)

- **출근하기는 근무 시작 1시간 전~1시간 후에만 된다**(사업장 설정 `check_in_after_minutes`, 기본 60). 조무사 시연의 오늘 D 근무(07:00)는 08:00이 지나면 홈이 '사업장에 알리기'로 바뀐다. 출근 장면을 보여 주려면 그 시간 안에 하거나, 관리자 `/live-demo`의 수동 출근을 쓴다.
- 지원은 같은 시간대 공고 여러 건에 할 수 있고(설계), **수락은 한 건만** 된다.
- 시연 공고의 예상 지급액은 관리자 공고와 같은 공식(4시간 이상 휴게 30분, 8시간 이상 60분 차감)이다.

## 시연 종료(철수) 절차 — 시연과 운영은 한 버전, 끝나면 데모만 사라진다

데모는 `facilities.is_demo`·`workers.is_demo`(`kakao_id 'kakao_demo_%'`)·`@demo.atman.co.kr` 계정으로만 식별되고, 실제 사용자 화면·RPC는 이미 `is_active`·`deleted_at`·`status='open'`·`is_demo` 로 걸러진다. 그래서 철수는 **코드 배포 없이 스위치와 데이터만으로** 된다. 정본 스크립트는 `scripts/prepare-production.sql`(트랜잭션 가드 2개 필요: `app.environment='production'`, `app.confirm_demo_cleanup='YES'`).

1. **앱 스위치(Vercel 환경변수 → 두 앱 재배포)**
   - `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=0` (admin-web·worker-web): 시연 버튼, `/api/demo-login`, `/demo`, `/gig/demo`, 초대 화면의 시연 입구 숨김(빌드 시 결정)
   - `DEMO_SHOWCASE_ENABLED=false` (admin-web): `expire-shifts` 크론(매일 08:30)의 revive 중지. 이걸 빼먹으면 revive 가 데모 계정 비밀번호를 매일 되돌리고(`revive-showcase.ts:122-125`) soft delete 된 사업장을 못 찾아 500 로그를 남긴다
   - `DEMO_ACCOUNT_PASSWORD` (admin-web·worker-web) 제거
2. **DB 끄기(되돌릴 수 있음)** — `scripts/prepare-production.sql` 실행: 데모 pg_cron 해제 · 데모 계정 `banned_until=infinity`+비번 무작위 · 데모 근무자 `deleted_at` · 데모 사업장 `is_active=false, deleted_at` · 데모 새로고침 함수 권한 회수. 그 스크립트에 없어서 **같은 트랜잭션에 덧붙일 것 3개**:
   ```sql
   UPDATE public.app_demo_settings SET master_invite_enabled = false;                       -- 마스터 초대코드 OFF
   UPDATE public.shifts s SET status='cancelled' FROM public.facilities f                    -- 데모 공고는 열린 채 남지 않게
     WHERE f.id=s.facility_id AND f.is_demo AND s.status IN ('open','in_progress');
   UPDATE public.workers SET deleted_at=COALESCE(deleted_at,now())                           -- is_demo 가 안 찍힌 옛 데모 워커
     WHERE kakao_id LIKE 'kakao_demo_%' AND deleted_at IS NULL;
   ```
   실행 전 수 확인: `SELECT count(*) FROM facilities WHERE is_demo; SELECT count(*) FROM workers WHERE is_demo OR kakao_id LIKE 'kakao_demo_%'; SELECT email FROM auth.users WHERE email LIKE '%@demo.atman.co.kr';`
   이 순간부터 근처 공고·공개 공고·지원·초대 수락·시연 로그인에서 데모가 전부 빠진다. 병원 데모 워커도 같은 규칙.
3. **확인** — 위 SELECT 가 기대대로인지, `SELECT jobname FROM cron.job` 에 demo 잡이 없는지, 두 앱 시작 화면에 시연 입구가 없는지, 다음날 08:30 크론 로그에 revive 가 skipped 인지.
4. **(선택·나중) 영구 삭제** — 시연 데이터엔 실명 개인정보가 없어 급하지 않다. 지울 때는 FK 가 CASCADE 가 아닌 테이블부터: `wage_payment_instructions`(facility·worker RESTRICT) → `service_usage_events`·`service_invoices`·`service_addon_credits`·`payment_orders`·`facility_subscriptions`(facility RESTRICT) → `shift_reviews`·`attendance_audit`·`settlements`·`wage_calculations`·`payroll_ledger`·`payslips`(옛 테이블, `public.` 접두어 없이 선언돼 CASCADE 없음) → `shift_attendances` → `shift_applications` → `shifts` → `facilities` → `auth.users`(workers·profiles CASCADE) → `workers`. 스크립트는 그때 작성·검토.

### 2026-10-14 자동화 정책 (저녁 확정)

- **매일 08:30 KST 자동 재시드는 유지한다**(`expire-shifts` 크론 → `reviveDemoShowcase`). 영업 전 시각이라 진행 중인 시연을 지우지 않고, 데모 사업장 50곳의 공고·확정·지원·대타·채팅과 긱 시연 사업장 정리를 매일 새로 만든다. 끄는 스위치는 `DEMO_SHOWCASE_ENABLED=false`(철수 때만).
- **15분 크론 `refresh_demo_worker_readiness()`는 보조**: 긱 페르소나(초대 근무 시연)의 근무시간을 '지금~45분 뒤'로 맞춰 출근·퇴근이 바로 되게 하고, 라이브 시연(`LIVE-SALES-DEMO-%`) 공고 시각만 지금 기준으로 옮긴다. 일반 시연 공고(`DEMO-SHOWCASE-OPEN-%`)의 D·E·N 시간은 건드리지 않는다(2026-10-14 오후 한때 3곳 공고를 45분짜리로 옮기던 버전은 되돌림).
- 예전 SQL 크론(`demo_showcase_refresh_0005kst` 등)은 비활성 그대로 둔다. 재시드 경로는 08:30 revive 하나다. `supabase/restore_demo_crons.sql` 은 실행하지 않는다.
- 급한 전체 초기화는 인증된 `POST /api/cron/revive-demo` 에 `{"confirmReset":"RESET_DEMO_DATA"}` (`GET` 은 405).

철수 검증에는 기존 로그인 세션, 미발송 알림·푸시 구독, 마스터 초대코드, 수동 초기화 함수의 실행 권한까지 포함해야 한다. 위 철수 절차만으로 이 검증이 완료된 것은 아니다. 변경된 정책의 적용 상태와 잔여 검증은 `docs/review/2026-10-14_MD_잔여검증.md`를 따른다.
