# 잇닿 출시 남은 작업 (핸드오프)

> 2026-07-08 종합 감사 기반. 전체 리포트는 감사 아티팩트 참조.
> 이 문서는 **세션이 끊겨도 이어서 작업**할 수 있도록 남은 P0/P1을 파일·라인·코드 스케치까지 정리한 것.

---

## ✅ 이번 세션에 완료된 것 (커밋 전, 로컬 워킹트리에 있음)

### 마이그레이션 — `supabase/migrations/20260709000000_launch_hardening.sql` (✅ db push 완료)
- **P0-1** `facilities.invite_code` 컬럼 추가 + 기존 시설 랜덤 코드 채움
- **P0-2** `push_subscriptions` 테이블 + RLS + GRANT (웹푸시 복구)
- **P0-3** `shift_applications.checked_in_at/checked_out_at` 컬럼 + status에 `'completed'` 추가 + `credit_ledger` spend 시프트당 유니크
- **P0-6** `credit_ledger(org_id,ref,delta)` earn 유니크 (이중 적립 차단)
- **P0-9** `profiles` UPDATE `WITH CHECK` — 클라이언트 `role='admin'` 차단
- **P0-10** `workers` BEFORE UPDATE 트리거 — 자가 승인/세금 조작 차단
- **P0-11** `facilities` 민감컬럼 anon/authenticated SELECT 회수 (PII·사업자번호·qr_secret·invite_code 제외)

### 코드
- **P0-3·4·5** `apps/admin-web/app/checkin/actions.ts` — 체크아웃 재작성: 생성컬럼 write 제거, KST 야간 계산, 일일 연장(+50%), 멱등·에러체크, 음수 클램프
- **P0-6(앱)** `apps/admin-web/app/membership/success/page.tsx` — 유니크 위반(23505)을 멱등 성공 처리
- **P0-12** `apps/admin-web/app/login/page.tsx` — 데모 로그인 `NODE_ENV!=='production'` 가드
- **P1-1** `apps/admin-web/lib/pay.ts` + `lib/actions/shifts.ts` — 최저임금 9,860→10,320
- **P1-3** `apps/worker-web/tailwind.config.ts` — `warn: '#FF8B00'` 토큰 추가
- **P0-8** `apps/admin-web/lib/actions/workers.ts` — approve/rejectWorkerAction에 `getCurrentFacilityId()` 인증 가드 추가(미인증 호출 차단). ⚠️ 후속: 다른 서버 액션(shifts/applications/checkin)도 동일 가드 + 대상 시설 스코프 검증 권장

### Vercel
- admin-web / worker-web **Production**에서 `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` 제거 완료 (다음 배포부터 적용)

### ⚠️ 배포 전 확인
- [ ] `supabase db push` 완료 ✅ (사용자 확인)
- [ ] 각 앱 `npm run build` 로 타입/빌드 확인
- [ ] 초대코드 조회: `SELECT id, name, invite_code FROM facilities WHERE deleted_at IS NULL;` → 병원에 전달
- [ ] 커밋 아직 안 함 — 정리 후 커밋 필요

---

## 🔴 남은 P0 (출시 블로커)

### ✅ P0-8 · 관리자 서버 액션 인증/인가 (완료 — 아래는 후속 강화 참고)
**파일**: `apps/admin-web/lib/actions/workers.ts:6` `approveWorkerAction`, `:25` `rejectWorkerAction`
**문제**: service-role(RLS 우회)로 돌면서 세션·역할·소유권 체크가 전무. 미인증 공격자가 raw `workerId`로 POST → 임의 워커 승인/대량 거절 가능.
**수정**:
1. 각 서버 액션 시작에서 세션/베어러로 호출자 확인 + `profiles.role='admin'` 서버 검증.
   - `getCurrentFacilityId()`는 이미 서명 쿠키 기반이므로, 이걸 필수로 요구하고 없으면 throw.
   - 대상 워커가 **해당 시설의 지원자/스태프인지** 확인 후에만 승인/거절.
2. 같은 패턴을 다른 service-role 서버 액션에도 적용: `lib/actions/shifts.ts`(createShift/cancelShift), `applications/actions.ts`(acceptApplication), `checkin/actions.ts`(recordCheckin) — 이들은 이미 `getCurrentFacilityId()` 스코핑은 있으나 **역할 검증은 없음**.
**스케치**:
```ts
// lib/auth-guard.ts (신규) — 서버 액션 공통 가드
import { adminClient } from '@/lib/supabase';
import { getCurrentFacilityId } from '@/lib/facility';
import { cookies } from 'next/headers';

export async function requireFacilityAdmin(): Promise<{ facilityId: string; userId: string }> {
  const facilityId = await getCurrentFacilityId();
  if (!facilityId) throw new Error('UNAUTHORIZED');
  // getCurrentFacilityId 는 서명 쿠키 검증 → 쿠키 발급 시점(set-facility)에서 소유권 확인됨.
  // 추가로 profiles.role='admin' 재확인이 필요하면 세션 토큰에서 user 추출 후 검사.
  return { facilityId, userId: '' };
}
```
> 주: 현재 서버 액션은 클라이언트에서 access_token을 넘기지 않음. 가장 견고한 방법은 액션을 API route로 옮기거나, 액션에서 `cookies()`의 Supabase 세션을 읽어 `getUser()` → role 검증. 최소한 `approve/rejectWorkerAction`은 대상 워커를 시설 스코프로 제한할 것.

---

### P0-13 · Mock 데이터가 프로덕션에 유출
**파일**: `apps/admin-web/lib/db/shop.ts:15,27` (`getShop`) · `lib/db/applications.ts:66,132` (`getPendingApplications`/`getPendingCount`) · `lib/mock.ts`
**문제**: `facilityId` 없으면 하드코딩 mock("수성못 카페", 가짜 간호사 홍길동/김간호/박수간) 반환. 인증됐지만 시설 없는 사용자를 claim으로 보내는 서버 가드도 없음.
**수정**:
1. DB 레이어에서 mock 폴백 삭제 → `!facilityId`면 중립값 반환:
   ```ts
   // shop.ts
   if (!facilityId || !sb) return null;               // SHOP mock 대신
   // applications.ts
   if (!facilityId || !sb) return [];                 // getPendingApplications
   if (!facilityId || !sb) return 0;                  // getPendingCount
   ```
   호출부(`app/page.tsx` 등)가 null/빈 배열을 이미 처리하는지 확인, 아니면 빈 상태 UI 추가.
2. 시설 가드 추가 — 인증됐지만 유효 시설 없으면 `/setup/claim-facility`로 리다이렉트.
   - `components/Shell.tsx` 또는 `app/layout.tsx`(서버 컴포넌트)에서 `getCurrentFacilityId()` 확인 후 `redirect('/setup/claim-facility')`. `/setup/*`·`/login`·`/auth/*`는 예외.
3. `lib/mock.ts` 의 `SHOP`/`MOCK` export 제거(또는 데모 전용으로 격리).
**검증**: 시설 쿠키 지운 상태로 대시보드 진입 → 카페/가짜 간호사 대신 claim 페이지로 이동해야 함.

---

### P0-14 · 데모 마이그레이션이 프로덕션에서 실행됨  ▶ 청소 스크립트 준비됨: `supabase/prod_demo_teardown.sql` (프로덕션 SQL Editor에서 수동 1회 실행)
**파일**: `supabase/migrations/20260705102000_demo_showcase_refresh.sql` (하드코딩 비번 auth.users 5개 + 일일 cron) · `20260705101000_demo_worker_location_cron.sql` (존재하지 않는 함수 호출 cron 3개 → 하루 3번 실패)
**문제**: 데모 계정/크론이 env 게이팅 없이 prod에 상주. `rotate_demo_worker_locations`는 seed 파일에만 있어 prod에서 cron이 계속 실패.
**수정 (이미 push된 상태이므로 새 마이그레이션으로 되돌림)**: `20260709010000_demo_teardown_prod.sql` 신규 작성:
```sql
-- 데모 크론 해제 (이름은 데모 마이그레이션의 cron.schedule 첫 인자와 일치시킬 것)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job
  WHERE command ILIKE '%rotate_demo_worker_locations%'
     OR command ILIKE '%demo_showcase%';
EXCEPTION WHEN undefined_table THEN NULL; -- pg_cron 미설치 환경
END $$;

-- 데모 로그인 계정 제거 (프로덕션에서만!)
DELETE FROM auth.users WHERE email LIKE '%@demo.atman.co.kr';
-- profiles/workers 등은 FK CASCADE 로 정리됨.
```
> ⚠️ 로컬/데모 환경에서는 이 마이그레이션을 돌리면 시연 데이터가 사라짐. **환경 분리**가 근본책: 데모 seed/cron은 마이그레이션에서 빼서 `supabase/seed_demo_*.sql` 로만 두고, 데모 프로젝트에서 수동 실행. 위 teardown은 이미 prod에 들어간 것을 청소하는 용도.
**확인**: `SELECT * FROM cron.job;` 로 실패 크론이 사라졌는지, `SELECT email FROM auth.users WHERE email LIKE '%demo%';` 로 데모 계정 제거 확인.

---

### P0-15 · 온보딩 데이터 유실 + 에러 삼킴
**파일**: `apps/worker-web/app/onboarding/page.tsx:31-112` (`handleOtpNext`), `components/onboarding/OTPVerification.tsx:71`
**문제**:
- 스텝이 URL/히스토리에 없어 뒤로가기 시 온보딩 전체 이탈 + 입력 소실.
- `handleOtpNext`가 `workers.upsert`/위치 upsert/RPC/`profiles.update` 에러를 전부 무시하고 무조건 `go('review')` → 네트워크 실패 시 `workers` row 미생성 → 영구 미승인.
- 버튼 로딩/비활성 없어 더블 서브밋.
**수정**:
1. 각 `await` 결과의 `error`를 확인, 하나라도 실패하면 `go('review')` 하지 말고 에러 상태 노출:
   ```ts
   const { error: wErr } = await supabase.from('workers').upsert({...}, { onConflict: 'auth_user_id' });
   if (wErr) { setSubmitError('가입 정보 저장에 실패했어요. 다시 시도해 주세요.'); return; }
   // ... 위치/RPC/profiles 도 동일하게 확인
   ```
2. 제출 중 버튼 비활성 + 스피너: `const [submitting, setSubmitting] = useState(false)` → `handleOtpNext` 시작에 `setSubmitting(true)`, finally에 false. `OTPVerification`의 "인증 완료" 버튼에 `disabled={submitting}` 전달.
3. 뒤로가기: `go()`에서 `history.pushState`/`router` 로 `?step=` 동기화하거나, `popstate` 리스너로 이전 스텝 복원.
4. **덤(P1-10)**: `Terms.tsx`에서 수집한 생년월일을 `onNext`로 끌어올려 `workers.upsert`의 `birth_date`에 실제 값 사용(현재 `'1990-01-01'` 하드코딩, 라인 74).
**검증**: 온보딩 중 네트워크 끊고 제출 → "심사 중" 대신 에러. 승인 대기 목록에 실제 row 생성 확인.

---

## 🟠 남은 P1 (높음 — 출시 직후라도)

| ID | 파일 | 내용 |
|---|---|---|
| P1-2 | `lib/db/staff.ts:98` | 예상 인건비 하드코딩 ₩10,320 → 월별 `wage_calculations.gross` 합산 |
| P1-4 | `worker/app/store/page.tsx` | 스토어 목업+죽은 결제버튼 → "준비 중" 게이팅 또는 실제 크레딧/체크아웃 연결 |
| P1-5 | migration `credit_ledger` | 만료 팬텀-음수: earn 만료 시 소비분 상계(FIFO) 또는 상계 `expire` 기록 |
| P1-6 | `CreditChargePanel.tsx:180` + migration | 환불 미구현 + `refund` kind CHECK에 없음(전자상거래법). 원금/보너스 분리(`kind:'bonus'`)부터 |
| P1-7 | `checkin/page.tsx:50` | QR 이중스캔 → 체크아웃 전 확인/최소경과시간/디바운스 |
| P1-8 | migration `shift_applications` RLS | 워커가 임의 status 변경 → INSERT/UPDATE 정책 분리(워커발 `cancelled`만) |
| P1-9 | `membership/success` | 토스 웹훅 추가(브라우저 리다이렉트 독립 확정) |
| P1-11 | `IDVerification/OTPVerification/BankAccount` | 신원·계좌·1원 OTP 실검증 없음 → 실연동 또는 "베타" 고지 정책 결정 |

## 🟡 P2 (엣지·정책)
음수 근무시간(✅ 이번에 체크아웃은 클램프됨) · 타임시트 UTC 표시(`timesheet/page.tsx:6`, `timeZone:'Asia/Seoul'` 추가 또는 Vercel `TZ=Asia/Seoul`) · 파괴적 액션 확인(지원자 거절/지원 취소) · safe-area · null pay `?? 0` · 시설 hard-delete cascade → RESTRICT · `text-tertiary`/`shadow-card` 토큰 · 직원 수 라벨·"가게" 카피 · 지오매칭 미연결 · Kakao REST 키 `NEXT_PUBLIC_` 제거 · a11y label · `credit_ledger.note`→`ref` · start==end 검증 · FacilitySwitcher 에러 어포던스.

---

## 권장 순서
1. **P0-8**(서버 액션 인가) — 보안, 마이그레이션 없이 코드만
2. **P0-13**(mock 제거+가드) + **P0-14**(데모 teardown) — 프로덕션 배포 게이트
3. **P0-15**(온보딩) + P1-10(생년월일)
4. P1 나머지 → P2

## 참고: 이번 세션 커밋
아직 커밋 안 됨. 정리 시:
```
git add apps/admin-web/app/checkin/actions.ts apps/admin-web/app/login/page.tsx \
        apps/admin-web/app/membership/success/page.tsx apps/admin-web/lib/actions/shifts.ts \
        apps/admin-web/lib/pay.ts apps/worker-web/tailwind.config.ts \
        supabase/migrations/20260709000000_launch_hardening.sql docs/launch-remaining-work.md
# (kakao-token·Splash.tsx 는 카카오 작업이라 별도 커밋 권장)
```
