# QA3 비즈니스 로직 검토 — 2026-10-20 (HEAD 9315694 + 미커밋 작업분)

## 요약 (3줄 이내)
- 단기·행사 예상 견적(pricing-proposal)은 정책 v9 숫자·경계값과 모두 일치하고 표시 전용이며, 과금 게이트(billing-gates) 로직은 리팩터만 되고 조건 변화가 없다. 단가 보호 마이그레이션은 픽스처 SQL 테스트 PASS(로컬, 롤백).
- P1 2건: ① 시급 지급액을 JS는 `round((분/60)×시급)`, DB는 `round(분×시급/60)`으로 계산해 .5 경계에서 1원 어긋나면 지급 기록이 영구히 거부됨(예: 12,345원×130분). ② 공용 시연 계정 sales-demo-1(super)이 의료 시연 사업장에서 추가 공고 청구서를 만들고 Toss 결제창까지 갈 수 있고 revive가 이를 치우지 않음(운영 키가 live면 P0).
- 로컬 Supabase는 마이그레이션이 20260711까지만 적용돼 있어 실제 테이블 대상 트리거 검증은 못 했고(픽스처만), `--linked`·운영·`db push`는 수행하지 않았다.

## 자동 지표 (실행 명령·결과)
| 명령 | 결과 |
|---|---|
| `cd ~/atman/apps/worker-web && npx vitest run lib/__tests__/pricing-proposal.test.ts lib/__tests__/gig-pay.test.ts lib/__tests__/admin-gig-operations.test.ts` | 3 files / 23 tests passed (384ms) |
| `node scratchpad/atman-qa/pricing-boundary.mjs` (estimateTemporary 직접 호출) | 1일 10,890 · 2일 21,780 · 3일 32,670(공급가 29,700) · 4~7일 42,900(공급가 39,000) · 8일 `quote:null` · 시작>종료 `null` · `2027-02-29` `null` · 연도 넘김 12/31~1/2 = 3일 · 윤일 2028 = 3일 · 30/50/51/0/NaN명 `quote:null` · 공백·`T00:00` 포함 문자열 `null` |
| `node scratchpad/atman-qa/pricing-sweep.mjs` (1~7일 정수 비교) | 불일치 0 |
| `node scratchpad/atman-qa/withholding-float.mjs` (1~20,000,000원 전수) | 3.3% 원천징수 JS 부동소수 vs 정수계산 불일치 0 |
| `node scratchpad/atman-qa/hourly-rounding-sweep.mjs` (시급 9,000~30,000 × 1~3,000분) | **JS vs DB 반올림 불일치 시급 4,434종** (예 `12345원×130분 JS=26747 DB=26748`, `9030원×11분 JS=1655 DB=1656`). `Math.round((m*r)/60)`로 바꾸면 불일치 0 |
| `supabase status` | 로컬 스택 실행 중 (DB 127.0.0.1:54322) |
| `docker exec supabase_db_atman psql -At -c "select version from supabase_migrations.schema_migrations order by version desc limit 3"` | **20260711250000** 이 최신 → 2026-09/10 마이그레이션 전부 미적용, 새 트리거도 없음 |
| `node scripts/qa-gig-contract-rates-sql.mjs \| docker exec -i supabase_db_atman psql -U postgres -v ON_ERROR_STOP=1` (BEGIN…ROLLBACK 픽스처) | `PASS: worked rate/basis immutable, initial configuration allowed, unworked edits allowed, paid/cancelled history protected, staff salary unchanged, attendance FOR UPDATE lock acquired, demo delete-before-reset works` → ROLLBACK |
| `scripts/qa-gig-contract-rates-sql.mjs` 내용 확인 | 파일 2개를 읽어 `public.`→`qa_gig_contract_rates.` 치환 후 stdout 출력만 함. **DB 접속 없음**. 상대경로라 저장소 루트에서만 동작 |

## 발견 사항
| 우선순위 | 영역 | 현상(재현/예시 값) | 원인(파일:줄) | 기대/수정 방향 |
|---|---|---|---|---|
| **P1** | 지급 금액 계산 | 시급 12,345원 근무자가 누적 130분이면 화면·JS 금액 26,747원, DB 재계산 26,748원 → `createGigPayoutAction` insert 시 트리거가 매번 "근태 또는 급여 기준이 바뀌었어요. 새로고침 후…" 발생 → 분이 바뀔 때까지 지급 기록 불가(dead-end). 시급이 60의 배수가 아니면 누구나 걸릴 수 있음(스윕 4,434/21,001종). 잘못된 금액이 저장되진 않음(DB가 거부) | `apps/admin-web/lib/db/gig-payouts.ts:41` `Math.round((minutes / 60) * rate)` — `(130/60)*12345 = 26747.499999999996`; DB는 `supabase/migrations/20261014180000_gig_payout_attendance_ledger.sql:63` `round(v_minutes::numeric * pay_rate / 60)` (정확한 .5 → 올림) | `Math.round((minutes * rate) / 60)` 로 변경(정수 곱 → 나눗셈은 .5를 정확히 표현, 스윕 0 불일치). 같은 패턴 `apps/admin-web/lib/pay.ts:32`(직원 급여, SQL `20261015010000:68` 동일 round)·`apps/worker-web/lib/gig-pay.ts:47`(워커 예상액, 추정)도 함께. `gig-pay.test.ts`에 `.5` 경계 케이스 추가 |
| **P1** (운영 Toss 키가 live면 **P0**) | 공용 시연 안전 · 결제 | sales-demo-1 → 의료 시연 사업장(모든 DEMO-TARGET에 `super`) → /membership 요금제 탭 "추가 공고 1건" 버튼 노출 → `issued` 청구서 9,000+900원 생성 → `/api/payments/orders` 로 Toss 주문 생성 → 결제창. 청구서·주문은 revive가 정리하지 않아 시연 사업장 '청구서' 탭에 미납 배지가 누적되고, live 키면 방문자가 실제 카드로 결제 가능 | `apps/admin-web/app/api/addons/job-posting/route.ts:9` `requireAdminContext(['owner','super'])`만 있고 `assertNotDemoFacility` 없음; `apps/admin-web/lib/payment-service.ts:44` 동일; `scripts/revive_demo.py:38,85` sales-demo-1 = `super`; `apps/admin-web/app/membership/page.tsx:86` 노출 조건 `!isGigworker && canPay && plan!=='free'`; 모든 유료 플랜 addon 9,000 (`20260812111000_job_posting_addon_credits.sql:8`); `lib/demo/revive-showcase.ts`·`revive_demo.py`에 `service_invoices`/결제 주문 정리 없음 | 두 경로에 `assertNotDemoFacility(context.facilityId)` 추가, `JobPostingAddonButton`·`ServiceInvoicePayButton`은 `shop.isDemo`면 숨김, revive에 demo 사업장 `service_invoices`/주문 삭제 추가. 운영 `NEXT_PUBLIC_TOSS_CLIENT_KEY` 모드 확인 |
| **P1** | 정책↔화면 오해 소지 | /membership(긱) 한 화면에서 인원 세는 규칙이 두 가지로 보임: 위 검토안 "초대만 보낸 사람은 제외", 바로 아래 현재 한도 "초대 대기·앱 미연결·미래 계약도 포함 · n/3명". 정책 v9 2항이 "현재 코드와 다르다"고 명시한 차이가 사용자에겐 모순으로 읽힘 | `apps/admin-web/app/membership/UsagePricing.tsx:27` vs `apps/admin-web/components/StaffCapacitySummary.tsx:9`; 구분 제목은 `membership/page.tsx:82` | UsagePricing 안에 한 줄: "지금 적용되는 등록 한도(아래 n/3명)는 초대 대기도 세요. 검토안과 세는 방식이 달라요." 또는 StaffCapacitySummary를 검토안 카드보다 위로 |
| P2 | 병원·약국 화면 유지 | 정책 "병원·약국·요양병원 화면 유지"인데 의료 /membership에도 `StaffCapacitySummary`("**현장별** 등록 한도"—긱 용어)와 `PlanContact`가 추가됨. 비소유자(canPay=false)는 PlanContact가 렌더되지 않는데 PlanCards 할인 안내 링크는 `#plan-contact`를 가리켜 빈 앵커 | `apps/admin-web/app/membership/page.tsx:84-85`, `PlanCards.tsx:64` | 의료는 기존대로 두거나 문구 "사업장 등록 한도"로; 링크는 canPay일 때만 |
| P2 | 문구 규칙(해요체) | "별도 견적**입니다**", "구성**입니다**", "적용**됩니다**", "처리하지 않**았습니다**" | `UsagePricing.tsx:26,27`, `app/sites/page.tsx:10`, `components/SiteOperationsSummary.tsx:8` | "별도 견적이에요", "구성이에요", "적용돼요", "처리하지 않았어요" |
| P2 | 게이트 메시지 | 의료 사업장에서 한도 초과 시 "Free**은** 관리 대상 3명까지… **이용 현황**에서 문의" — 조사 고정, '이용 현황'은 긱 탭 이름(의료는 '요금제') | `apps/admin-web/lib/billing-gates.ts:54` | "요금제 ${name}은(는) … 요금제·이용 현황 화면에서 문의" 또는 업종별 분기 |
| P2 | 마이그레이션 위생 | `CREATE TRIGGER`에 `DROP TRIGGER IF EXISTS` 없음(재실행·재적용 시 실패). 픽스처 테스트는 실제 `facility_staff`의 다른 트리거(`trg_facility_staff_demo_scope` 등)·RLS·FK와의 상호작용은 검증하지 않음 | `supabase/migrations/20261019090000_protect_gig_contract_rates.sql:15,29`; `supabase/tests/gig_contract_rates_transaction.sql:1-10` | DROP IF EXISTS 추가; 스테이징(또는 로컬 `db reset` 후)에서 실제 테이블로 1회 재현 |
| P2 | 단가 보호 부수효과 | `setStaffPayAction`은 급여 기준과 은행명·계좌 끝 4자리를 한 UPDATE로 저장 → 근태 있는 긱 계약은 계좌 정보만 바꾸려 해도 단가가 함께 바뀌면 전체 거부. 또 시연 사업장 guard 없음(가역: reset이 15,000원 복원) | `apps/admin-web/lib/actions/clinic-workforce.ts:411` | 단가 변경 없으면 통과하므로 UI에서 단가 입력을 잠그고(근태 있음 표시) 계좌만 저장 가능하게 |
| P2 | PlanContact 문의문 | 복사되는 문의 내용에 `현장 ID: <uuid>` | `apps/admin-web/app/membership/PlanContact.tsx:8` | 사업장 이름 + ID 뒤 6자리 정도가 직관적 |

### 시연 안전 점검 결과(막혀 있음 / 열려 있음)
- 막힘: 관리자 탈퇴(`withdraw_my_admin_account` `is_demo_account` — `20261014230000:108`, UI `AccountClosureSection.tsx:82`), 사업장 닫기(`close_my_facility` `is_demo` — `20261014230000:21`, `account.ts:14`), 워커 탈퇴(`20261005100000_block_demo_account_withdrawal.sql:44-47` 런타임 패치로 `withdraw_my_account`에 demo 차단 삽입; UI는 `/settings/withdraw` 직접 진입 가능하나 RPC가 거부), 근무자 연결 해제·근무 종료(`clinic-workforce.ts:370,419` `assertNotDemoFacility`), 사업장 설정 변경(`lib/actions/facility.ts:68,171,203,263,304`), 시연↔실사업장 교차 연결(DB 트리거 `20261014190000:60-65`), 플랫폼 관리자 권한(`platform-admin.ts:12,23` demo 메일 제외), 전체 재시드(`/api/cron/revive-demo` CRON_SECRET + `confirmReset`).
- 열림(가역): `setStaffPayAction`(위 P2), `createGigPayoutAction`(기록만, 송금 없음, reset이 삭제), 직원 등록·초대(cleanup이 삭제).
- 열림(비가역 성격): 추가 공고 청구서·결제 주문(위 P1).
- 로그인·전환: 실계정 → 시연 전환 시 confirm(`login/page.tsx:90`, `demo-session.ts:53`), 실패 시 세션 정리(`login/page.tsx:128`), `signOut({scope:'local'})`로 공용 refresh token 전역 폐기 방지(`AdminDemoBar.tsx:34`), 시연 현장 못 찾으면 503로 중단(`set-facility/route.ts:42-54`) — 모두 적절.

## 정책 문서 ↔ 코드 ↔ 화면 대조표
| 항목 | pricing_policy.md v9 | 코드 | 화면 문구 | 일치 |
|---|---|---|---|---|
| 10명 1일 공급가 | 9,900원 | `pricing-proposal.ts:14` `days*9900` | UsagePricing:26 "1일 9,900원" | ✓ |
| 1~7일 상한 | `min(일수×9,900, 39,000)` | `:14` `Math.min(…,39000)` | "연속 7일 이내 최대 39,000원(부가세 별도)" | ✓ |
| 예시 19~21일 | 3일 · 29,700 | 테스트 `:6`, node 확인 29,700/2,970/32,670 | "3일 · 10명까지 · 검토안 / 32,670원 부가세 포함 / 공급가 29,700원 + 부가세 2,970원" | ✓ |
| 4~7일 | 39,000 | 테스트 `:9`, node 4·5·6·7일 모두 42,900(39,000+3,900) | 동일 | ✓ |
| VAT 표기 | 포함 합계 + 공급가·세액 함께 | `vat=Math.round(net*0.1)`, `total=net+vat` | 큰 숫자 "부가세 포함", 아래 공급가+부가세 | ✓ |
| 30·50명 | 별도 견적 | `people!==10 → quote:null` | "별도 견적 · 인원과 기간을 운영팀에 알려 주세요" | ✓ |
| 8일 이상 | 별도 견적 | `days>7 → quote:null` | "8일 · … / 별도 견적" | ✓ |
| 복수 현장 | 별도 견적 | 현장 단위 계산(복수 입력 없음) | :14 "현재 선택한 현장 한 곳 기준" / :26 별도 견적 문구엔 '복수 현장' 누락 | △ |
| 기간 정의 | KST 양끝·중간 휴무 포함 연속 | UTC 자정 차 +1 (달력일, TZ·DST 무관) | :14 "시작일·종료일과 중간에 쉬는 날도 기간에 포함" | ✓ |
| 판매·자동 과금·권한 변경 금지 | 표시만 | UsagePricing 액션/fetch 없음, PlanContact 복사·전화만, PlanCards 앵커만 | :12 "아직 판매하지 않아요", :28 "선택해도 등록 한도·청구액은 바뀌지 않아요" | ✓ |
| service_plans·구독·청구서·베타 한도 불변 | 변경 금지 | 마이그레이션에 service_plans 변경 없음; billing-gates는 `remaining>0 ≡ count<limit` 동치 리팩터 | — | ✓ |
| 병원·약국·요양병원 화면·월 요금 유지 | 유지 | `isGigworker && <UsagePricing/>` ; 단 한도 요약·문의 카드는 전 업종 추가 | 의료 요금 숫자 변화 없음 | △ (P2) |
| 제안 한도 = 고유 근무자 수(초대 대기·미래 계약 제외) | "현재 코드와 다름" 명시 | `getStaffCapacity`: status≠ended & contract_end≥today(초대 대기·미래 계약 포함) | :27 정책안 / StaffCapacitySummary:9 현재 규칙 | △ (P1) |
| 현재 베타 한도 3명 | 유지 | `service_plans gigworker_trial included_attendance_slots=3` (`20260921140000:13`) | "현장별 관리 대상 3명", 홈 "관리 대상 3명(초대 대기 포함)" | ✓ |
| 워커 무료 | 유지 | 워커 과금 코드 없음 | intro 변경 없음 | ✓ |
| 법적 분류 단정 금지 | 금지 | — | 검토 범위 화면에 법적 문구 없음 | ✓ |
| 무제한·영구 보관 금지 | 금지 | — | 긱 "계속 보관"(영구 아님); PlanCards `enterprise '공고 무제한'`은 기존 v7 의료 플랜 | ✓ / 기존 |
| "매칭" 금지 | 금지 | — | 검토 범위 파일 grep 0건 | ✓ |
| 30일 무료 체험(intro:105) | 의료 관리자만 | `restart_trial_on_first_claim` `v_today+29`(양끝 30일), `expire_service_trials`는 status만 expired(청구서 없음) | "자동으로 유료 전환되지 않아요" | ✓ |
| 추가 공고 9,900원(VAT 포함) | — | addon 9,000+900 (`addons/job-posting/route.ts:21-24`) | PlanCards "추가 공고 1건 9,900원(VAT 포함)" | ✓ |

## 출시 전 확인 필요(사용자 결정 사항)
1. 운영 Toss 키 모드(`NEXT_PUBLIC_TOSS_CLIENT_KEY`가 `live_`인지) — P1 결제 경로의 등급(P0 여부)을 결정. 로컬 `.env.local`에는 해당 키가 없어 확인 못 함(vercel 명령은 금지 사항이라 미실행).
2. 의료 /membership에 "등록 한도 요약 + 운영팀 문의 카드"를 그대로 둘지(정책은 화면 유지).
3. 지급 완료(paid) 기록은 정정·취소 불가(scheduled만 취소, `gig-pay/actions.ts:105`, DB `20261014180000:24`) — 잘못 기록했을 때 운영 절차 필요.
4. 추가 공고 addon 9,000원이 basic/pro/enterprise에도 설정돼 있음(`20260812111000:8`) — 의도인지.
5. 로컬 DB가 2026-07 스키마라 새 마이그레이션(단가 보호)을 실제 테이블에서 돌려 보지 못함 — 스테이징 적용 후 ① 근태 있는 긱 계약 단가 변경 거부 ② 데모 reset 정상 ③ 체크인 동시성 1회 확인 권장.
6. intro "시범 사업장 3개월 이용 지원"은 코드 외 영업 약속.

## 잘 된 점 (3개 이내)
- 계약 단가 보호 트리거: 근태(check-in) 있는 긱 계약만 막고 최초 설정·미근무 수정은 허용, 지급 취소 후에도 보호, 데모 reset(근태 삭제→단가 갱신, `20260928113000:163-173`)과 순서 정합, payout 트리거와 같은 잠금 순서(staff→attendance)라 교착 유형이 늘지 않음. 서비스 롤도 트리거는 우회 못 함.
- `readAllRows`: id 커서 페이지로 1,000행 상한 제거, 중복/역행·중간 오류를 부분 성공으로 삼지 않고 throw(1001행 테스트 포함), 호출부에서 기존 `.order()`를 제거해 커서 정합성 유지.
- 시연 전환 UX: 실계정 로그인 상태면 confirm, 실패 시 세션 되돌림, `signOut({scope:'local'})`, 탈퇴·사업장 닫기·동의 변경은 DB 함수 레벨에서 demo 차단.
