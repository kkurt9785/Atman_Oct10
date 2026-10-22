# QA3 비즈니스 로직 점검 — 2026-10-22 (HEAD `5ece90d`, 운영 = `fcf6d81` v9.1 배포본)

읽기·탭 이동·요금 계산기 입력만 했고 결제·승인·저장·초기화는 누르지 않았다. 저장소·git·vercel·DB 쓰기 없음. 원자료: 이 폴더의 `*_capture.json`, `pricing_calc_result.json`, `shots/`(스크린샷 24장), 스크립트 4개.

## 요약 (3줄)
- 요금 v9.1: 단기·행사 시연 계산기 9케이스(10명 3일 32,670 / 30명 8일 108,790 / 25→30명 14일 152,900 / 50명 8일·15일·51명 별도 견적 등) 전부 정책·코드와 일치하고 표시 전용이다. 의료 시연엔 검토안이 숨겨져 있으나 **등록 한도 카드·PlanContact·'공고 1건 추가 9,900원' 버튼은 10/20 그대로**(#10·#2 미수정, 운영 번들에 Toss 키 없음 확인 → #2는 P1 유지).
- 금액: 10/14 P0 #1·#2는 **수정 확인**(홈 '7월 급여 1건'→해당 월, 9월 합계 12,072,000원에 일할 전 정도윤 제외). 10/20 #3 시급 반올림 JS/DB 불일치는 **5곳 그대로**. 미해결이던 근태 요약 178:04 vs 급여 162:20은 **시드가 '지각(late)' 상태로 남긴 2일(7:52×2=15:44, 283,200원)이 급여(status='completed'만)에서 빠진 것**으로 규칙을 확정했다 — 화면 안내 없음.
- 공용 시연: 비가역 동작은 코드에서 막힘 유지, 열림 목록은 10/20과 동일. 시연 3계정은 여전히 전부 super(문서 `DEMO_GUIDE.md:21`은 정정됨). 새 P1 3건: 지각 행 급여 제외 무안내, 지급 대기 링크가 엉뚱한 탭으로 열림, 약국·라이브데모 시드 공고 예상액 휴게 미차감(152,000 vs 133,000).

## 자동 지표 (실행 명령·결과)
| 명령 | 결과 |
|---|---|
| `cd ~/atman/apps/worker-web && npx vitest run lib/__tests__/pricing-proposal.test.ts lib/__tests__/gig-pay.test.ts lib/__tests__/admin-gig-operations.test.ts` | 3파일 **26 테스트 통과** (323ms) |
| `node admin_capture.mjs hospital …`(11라우트) · `care`(4) · `pharmacy`(3) · `gigworker`(5) — `?demo=` 자동 로그인 후 innerText·스크린샷 | 4xx/5xx 0 · 콘솔 오류 0 · 전 라우트 정상 렌더 |
| `node pricing_calc.mjs` — 긱 시연 `/membership` 계산기 9케이스 입력(저장 없음) | 9/9 정책값 일치 (아래 대조표) |
| `node worker_capture.mjs 간호조무사 /home /shifts /applications` · `약사 /shifts` | 조무사 공고 ₩101,500(관리자 공식 일치) · 약사 공고 ₩152,000(**불일치**) |
| `node toss_key_probe.mjs` — 운영 관리자 번들 13개에서 `test_ck_/live_ck_` 검색 | **0건**(키 미설정) · `membership/page-ca8ab290….js`에 JobPostingAddonButton 포함 |
| 금지어 grep(앱 문자열, 주석 제외) | '매칭' 0 · '시프트' 앱 0 · '워커/긱워커' 사용자 노출 약 50곳(아래 P2). SQL: '시프트' RAISE 원문 잔존하나 `20261002130000_copy_unify_shift_wording.sql:19-34` 런타임 치환, '매칭이 확정됐어요' `20261014120000:95` 치환 |
| 격식체 grep | `UsagePricing.tsx` 해요체로 수정됨 ✅ · `app/sites/page.tsx:10` '적용됩니다' ❌ · `components/SiteOperationsSummary.tsx:8` '…않았습니다' ❌ |
| `curl https://itdot.co.kr/jobs` | '지금은 모집 중인 공고가 없어요'(공개 폴백 금액 화면 재현 불가) |

## 금액 검증 표 (항목 | 화면 값 | 코드/정책 값 | 일치)
| 항목 | 화면 값 | 코드/정책 값 | 일치 |
|---|---|---|---|
| 근무자 `/shifts` 조무사 — 광교참재활요양병원 23:00–07:00 · 시급 14,500 | ₩101,500 | `lib/pay.ts:17-32` 480−60=420분 → 101,500 (시드 `revive-showcase.ts:233,301` `calcEstimatedShiftPay`) | ✅ 10/14 #12 시드 수정 확인 |
| 근무자 `/shifts` 약사 — 수원 온누리 데모약국 09:00–13:00 · 시급 38,000 | ₩152,000 | 관리자 공식 240−30=210분 → **133,000** | ❌ SQL 시드 하드코딩 `20260804120000_demo_pharmacy_staff_account.sql:105`, `20260730100000:135` (라이브데모 `20260814104000:36` 40,000/160,000, `:45` 16,000/80,000도 동일 패턴) |
| 공개 `/jobs/[id]` 폴백 · `/shifts` 게스트 폴백 | (오늘 데이터 없음) | `jobs/[id]/page.tsx:35` `hourly_wage*hours`, `shifts/page.tsx:225` `(minutes/60)*wage` — 휴게 미차감 | ⚠ DB 값 있으면 미사용, 폴백만 다른 공식 |
| 관리자 `/payroll?month=2026-09` 병원 합계 | 12,072,000원 · '일할계산 전 1명 제외' | 3,200,000+2,800,000+2,922,000+3,150,000 (정도윤 3,000,000 제외, `payroll/page.tsx:45-46`) | ✅ 10/14 P0 #2 수정 |
| 이민준(병원) 시급 18,000 × 162:20 | 2,922,000원 | 9,740분×18,000/60 = 2,922,000 (`payroll.ts:62`) | ✅ |
| 이민준(요양) 시급 18,000 × 162:00 · 요양 합계 | 2,916,000 · 12,066,000 | 9,720×18,000/60 · 행 합 | ✅ |
| 이지은(약국) 시급 38,000 × 16:04 | 610,533원 | 964×38,000/60 = 610,533.33 → JS·DB 모두 610,533 | ✅ (.5 경계 아님) |
| 홈 '지급 대기' | '7월 급여 · 1건' → `/payroll?month=2026-07` | `operations.ts:376-379` 가장 이른 대기 월, `page.tsx:129` | ✅ 월 기준 (10/14 P0 #1) / ⚠ 탭(아래 새 발견 #2) |
| `/operations` | '급여 승인·지급 대기 (7월) 1건' | `operations/page.tsx:168` | ✅ 홈과 동일 |
| 7월 대기 1건 실체 | 공고 지원 인력 탭: 수원 권선구 데모약사 02 · 7/27 · 지급 승인 · 140,000 | `wage_payment_instructions` status approved | ✅ 건수 일치 |
| 근태 요약 vs 급여 시간(이민준 9월) | 요약 178:04(22일) / 급여 162:20(20일) | 9/4·9/18 상태 'late' 7:52×2 = 15:44. 급여는 `shared/gig-pay/calculation.ts:19` + SQL `20261015010000:62` `status='completed'`만, 요약 `lib/db/attendance-history.ts:29`는 상태 무관 | ⚠ 규칙 확정(시드 `20260810001000_care_demo_month_history.sql:34` seq 4,14 → 'late'에 퇴근 채움). 실제 퇴근 RPC는 `20260916100000:292` completed로 전이, 기록 수정 RPC도 `20261014220000:74` completed → 실사용은 안전, 시연·안내 문제 |
| 긱 시급 반올림 | (재현 데이터 없음: 시연 시급 15,000·18,000·38,000은 분×시급/60이 .5가 될 수 없음) | `gig-payouts.ts:41` `Math.round((minutes/60)*rate)` vs DB `20261014180000:63` `round(minutes*rate/60)` → 12,345×130분 26,747 vs 26,748. 같은 패턴 `pay.ts:32`, `payroll.ts:62`(`work.minutes/60*rate`), worker `gig/settlement/page.tsx:131`, `shifts/page.tsx:225` | ❌ 10/20 #3 그대로(5곳) |
| 7월 직원 급여 | 김민서·박서윤 '완료 근태 0일 0시간' · 세전 예상액 월급 전액 · 지급 예정 6,140,000 | `payroll.ts:56` 계약 겹침만 검사, `:62` 월급은 rate 그대로 | ⚠ 근태 0일 월급 전액 — 정책 결정 필요 |
| 긱 `/gig-pay` 시연 | 긱워커 데모 시급 15,000 · 0원 · '마지막 지급 이후 완료된 근무가 없어요' | `amountFor` days=0 → 0 (`gig-payouts.ts:40`) | ✅ |
| 운영 '이번 달 예정 인건비' 356,500 | — | `operations.ts:360,401` 이달 공고 `estimated_total_pay` 합(취소 제외) | ✅ 정의대로 |

## 요금 v9.1 운영 대조표 (입력 | 화면 | 정책 | 일치)
| 입력 (긱 시연 `/membership` 이용 현황 탭) | 화면 | `docs/pricing_policy.md` v9.1 / 코드 | 일치 |
|---|---|---|---|
| 10명 · 10/19~10/21 (3일) | "3일 · 10명까지 · 검토안 / 32,670원 부가세 포함 / 공급가 29,700원 + 부가세 2,970원" | 예시 '3일 29,700(부가세 포함 32,670)' · `pricing-proposal.ts:29` | ✅ |
| 10명 · 4일 | 42,900원 (39,000+3,900) | 4일째부터 주 정액 39,000 | ✅ |
| 30명 · 10/19~10/26 (8일) | 108,790원 / 공급가 98,900원 + 9,890원 | 예시 '30명 8일 = 98,900' · `:31` min(79,000+19,900, 139,000) | ✅ |
| 25명 14일 → select에 25 없음, **30명** 선택 · 10/19~11/1 | 152,900원 / 139,000 + 13,900 | 예시 '25명 14일 = 30명 구간 2주 139,000' · 테스트 `:31` | ✅ (단, 25명을 직접 입력할 수 없음 — P2) |
| 50명 · 8일 | "50명 현장의 8일 이상은 별도 견적이에요. 인원과 기간을 운영팀에 알려 주세요." | '50명 현장의 8일 이상 별도 견적' · `:30` twoWeeks null | ✅ |
| 50명 · 15일 | "15일 이상은 별도 견적이에요." | 15일 이상 별도 견적 · `UsagePricing.tsx:8` | ✅ |
| 51명(50명 초과 · 상담) · 1일 | "1일 · 50명 초과 · 검토안 / 50명 초과는 별도 견적이에요." | 50명 초과 별도 견적 · `temporaryTier` null | ✅ |
| 10명 · 15일 | "15일 이상은 별도 견적이에요." | 동일 | ✅ |
| 종료 < 시작 | "날짜를 확인해 주세요. 종료일은 시작일보다 빠를 수 없어요." | `estimateTemporary` null | ✅ |
| 앵커 표 3×3 | 9,900/39,000/69,000 · 19,900/79,000/139,000 · 29,900/119,000/별도 견적 ("검토 중인 공급가 · 부가세 별도") | 정책 표 | ✅ |
| 계산식 문구 | "1~3일은 1일 단가로, 4일째부터는 주 정액… 8~14일은 … 2주 정액을 넘지 않아요. 15일 이상·50명 초과·복수 현장은 별도 견적이에요." | 규칙 + 복수 현장(10/20 P2 누락 → 추가됨) | ✅ |
| 인원 기준 문구 | "근무표에 올린 사람 수… 초대만 보낸 사람은 세지 않아요. 지금 적용 중인 등록 한도(아래 표시)는 초대 대기도 세는 방식이라 검토안과 달라요. … 자동으로 추가 청구하지 않아요." | 규칙 2 '두 기준이 다르다는 점을 한 줄로' | ✅ (10/20 #9 문구 부분 반영) |
| 판매·과금 불변 | "아직 판매하지 않아요" · "선택해도 등록 한도·청구액은 바뀌지 않아요" · 컴포넌트에 fetch/액션 없음 | 표시만 | ✅ |
| 의료 시연 `/membership` (병원·약국·요양) | 검토안 섹션 없음 · Pro 169,000 / Pharmacy Plus 99,000 그대로 | '병원·약국·요양병원 화면·월 요금 유지' | ✅ 숨김 / ❌ 한도 카드·PlanContact 추가분은 그대로(10/20 #10) |
| 무료 베타 한도 | 홈 '관리 대상 3명(초대 대기 포함)' · `/membership` '1/3명' · `/staff` '현장별 등록 한도 1/3명' | `gigworker_trial included_attendance_slots=3` | ✅ |
| 30일 무료 체험 | intro:105 '30일 무료 체험 … 자동으로 유료 전환되지 않아요' · claim-facility:359 | `v_today+29`(양끝 30일, `20260722010000:57` 등), 만료는 status만 | ✅ |
| 수수료 0원 | login:144, membership:95, intro:107, `/jobs` | 워커 과금 코드 없음 | ✅ |
| 추가 공고 9,900(VAT 포함) | PlanCards · 버튼 '공고 1건 추가 · 9,900원' | 9,000+900 (`addons/job-posting/route.ts:21-24`) | ✅ 숫자 / ❌ 시연 가드 |

## 권한 표 (역할 | 화면/동작 | 코드 | 실제)
| 역할 | 화면/동작 | 코드 | 실제(운영) |
|---|---|---|---|
| sales | `/operations` `/workforce` | 차단 카드 `operations/page.tsx:64`, `workforce/page.tsx:22` | ⚠ 검증 불가 — sales 시연 계정 없음(셋 다 super) |
| sales | `/live-demo` | `notFound()` `live-demo/page.tsx:35` | ⚠ 검증 불가 |
| sales/operator | 급여 열람 | `canViewPayroll`(위임 토글) 없으면 🔒 `payroll/page.tsx:28`, 홈 카드 '급여 담당자에게 확인' `page.tsx:129` | ⚠ 검증 불가 |
| operator | 직원·공고 급여 승인·이체·완료 | 버튼 `canManage` owner/super `payroll/page.tsx:26`; 서버 `payroll/actions.ts:7,53` `['owner','super']` | ⚠ 검증 불가(코드 일치) |
| operator | 긱 지급 기록·완료·취소 | `gig-pay/actions.ts:25,80,98` `['owner','operator','super']` + canViewPayroll | ⚠ 직원 급여(owner/super)와 기준이 다름 — 설계 확인 |
| owner/operator/super | 공고·수락·근태·대타 | `shifts.ts:44`, `applications/actions.ts`, `operations/actions.ts` 전부 3역할 | ✅ 10/14와 동일 |
| super & !demo | 면허 심사 | `lib/actions/workers.ts:12-14` | ✅ 네 시연 모두 섹션 없음 |
| owner/super | 추가 공고·결제 주문 | `addons/job-posting/route.ts:9`, `payment-service.ts:44` | ✅ 코드대로 노출(병원·약국·요양 시연에 버튼 보임) / ❌ 시연 가드 없음 |
| 시연 3계정 | 역할 | `revive-showcase.ts:34-38,158,169` 셋 다 `super`(+demo-1은 긱 현장도 super) | ✅ 실제 super(병원 시연에서 `/live-demo`·`/operations` '시연 초기화' 노출). `docs/DEMO_GUIDE.md:9-11,21` 정정됨 |
| 전 역할 | 베타 한도 초과 메시지 | `billing-gates.ts:54` "`${planName}`은 관리 대상 N명까지… 이용 현황에서 문의" — 조사 고정, 의료 탭명은 '요금제' | ❌ 10/20 P2 그대로 |

## 공용 시연 안전 (막힘 / 열림(가역) / 열림(비가역))
**막힘(코드 레벨)**
- 관리자 탈퇴: RPC `withdraw_my_admin_account` is_demo 차단 + UI `settings/AccountClosureSection.tsx:36,82` '시연 계정은 탈퇴할 수 없어요'
- 사업장 닫기: `lib/actions/account.ts:14` `assertNotDemoFacility` + UI `:20,62`
- 근무자 연결 해제 `clinic-workforce.ts:370`, 긱 근무 종료 `:419`, 긱 프로젝트 취소·참여자 제외 `gig-projects.ts:94,166`
- 사업장 설정 변경: `facility.ts:68`(프로필) `:171`(네트워크 등록) `:203`(네트워크 해제) `:263`(급여 열람 권한) `:304`(위치)
- 면허 심사 `workers.ts:14`, 시연↔실사업장 교차 연결(DB 트리거), 플랫폼 관리자
- 전체 재시드: `api/cron/revive-demo/route.ts:14-23` CRON_SECRET + `confirmReset:'RESET_DEMO_DATA'`; GET 405
- 결제 UI: 운영 번들에 `NEXT_PUBLIC_TOSS_CLIENT_KEY` 없음 → `JobPostingAddonButton.tsx:11`, `CreditChargePanel.tsx:9` '결제 환경 설정이 필요해요'에서 API 호출 전 중단(사실상 막힘, 코드 가드는 아님)

**열림(가역 — revive/reset이 복원)**
- `/operations` '시연 초기화', `/live-demo` 'GPS 시연 준비'(`live-demo/actions.ts:63` `reset_three_facility_live_demo`, 지정 시연 사업장만 `:24`) — 설계된 시연 도구
- 급여 승인·이체·완료 표시: 시연이면 마감·전월 검사 생략 `payroll/actions.ts:25-30`, 공고 지원 인력은 당월도 버튼 `payroll/page.tsx:83`(`shop.isDemo`) → 7월 '데모약사 02' 건이 현재 '지급 승인' 상태로 남아 있음(revive가 LIVE 공고 instruction은 안 지움)
- 긱 지급 기록·취소(`gig-pay/actions.ts`, 송금 없음), 단가 변경 `setStaffPayAction`(가드 없음, reset 15,000 복원), 직원 등록·초대(cleanup 삭제), 공고 등록·수락·대타 승인(DEMO-SHOWCASE 매일 재생성)

**열림(비가역 성격)**
- 추가 공고 청구서 `issued` 생성 + Toss 주문: `addons/job-posting/route.ts:9`, `payment-service.ts:44` 둘 다 `requireAdminContext(['owner','super'])`만, `assertNotDemoFacility` 없음. UI는 키 부재로 멈추므로 **직접 POST로만** 가능. 현재 병원 청구서 탭 '발행된 서비스 청구서가 없어요'. revive에 `service_invoices`/`payment_orders` 정리 없음 — 10/20 #2 그대로(P1, 토스 신청 시 P0)

## 회귀 (10/14 ✅❌⚠ 표 / 10/20 ✅❌⚠ 표)
**10/14**
| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| P0 #1 | 지급 대기 월 기준 | ✅/⚠ | 홈·운영 '7월 급여 1건' → `/payroll?month=2026-07`(`operations.ts:376-379`). 단 직원 급여 탭이 먼저 열려 대기 건은 한 탭 뒤(새 발견 #2) |
| P0 #2 | 일할 전 월급 합산 | ✅ | 9월 12,072,000 + '일할계산 전 1명 제외'(`payroll/page.tsx:45-46,55`) |
| P0 #3 | 출근 창 밖 CTA | — | 근무자 UX 범위(QA1/2), 이번 점검 밖 |
| P1 #12 | 예상 지급액 공식 통일 | ⚠ | 병원·요양 TS 시드 ✅(₩101,500), 약국·라이브데모 SQL 시드 ❌(₩152,000·160,000·80,000), 폴백 2곳 ❌ |
| P1 #13 | 시드 `checked_in_at` | ✅ | `revive-showcase.ts:279-283` PATCH |
| P1 #15 | 약사 7/28 확정 잔존 | ⚠ | 약사 `/shifts`만 확인, '내 근무'는 미확인 |
| P1 #9 | 시연 계정 역할 | ⚠ | 코드 셋 다 super 그대로, `DEMO_GUIDE.md:21` 문서 정정 완료 |
| 맞은 것 | 시급 하한 이중 검사·종료 자동 제안·거리·운영 할 일 합·급여 합=행 합·권한 코드 | ✅ | 운영 할 일 5 = 대타 1+지원자 3+급여 1 (`operations/page.tsx:91`), 급여 합 재계산 일치 |
| 미해결 | 178:04 vs 162:20 | ✅ 규칙 확정 | 'late' 상태 2일 제외(위 표) → 새 발견 #1 |

**10/20**
| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| #2 | 결제 경로 시연 가드 | ❌ | 두 경로 `assertNotDemoFacility` 없음, 버튼 노출, revive 정리 없음. 운영 키 없음 확인 → P1 유지 |
| #3 | 시급 반올림 | ❌ | 5곳 그대로 |
| #9 | 긱 `/membership` 순서·규칙·PlanContact | ⚠ | 규칙 차이 한 줄 ✅(`UsagePricing.tsx:45`), 검토안이 현재 조건 위 ❌, `PlanContact` 옵션 1개 ❌ |
| #10 | 의료 한도 카드·PlanContact | ❌ | 병원·약국·요양 `/membership`·`/staff`에 '현장별 등록 한도 · 5/30명' 카드 그대로(`membership/page.tsx:84-85`, `staff/page.tsx`) |
| P2 | 격식체 4곳 | ⚠ | `UsagePricing` ✅, `sites/page.tsx:10` ❌, `SiteOperationsSummary.tsx:8` ❌ |
| P2 | 게이트 조사·탭명 | ❌ | `billing-gates.ts:54` |
| P2 | '복수 현장' 누락 | ✅ | `UsagePricing.tsx:44` |
| P2 | PlanContact 현장 ID 전체 | ❌ | `PlanContact.tsx:8` |
| P2 | '단기 알바 근태' 명칭 | ❌ | `login/page.tsx:24` |

## 새 발견
| 우선순위 | 영역 | 현상(예시 값) | 원인(파일:줄) | 기대 |
|---|---|---|---|---|
| P1 | 급여·근태 일치 | 병원·요양 시연 9월: 근태 요약 이민준 **178:04(22일)** vs 급여 **162:20(20일)**. 9/4·9/18 '지각' 행(각 08:12→17:04, 7:52, 합 15:44 = **283,200원**)이 급여에서 빠지는데 어느 화면에도 '제외' 안내가 없어 두 숫자가 어긋나 보임 | 시드 `supabase/migrations/20260810001000_care_demo_month_history.sql:34` seq 4,14 → status `'late'`에 퇴근까지 채움. 급여 `apps/admin-web/lib/shared/gig-pay/calculation.ts:19`·SQL `20261015010000:62`는 `status='completed'`만, 요약 `lib/db/attendance-history.ts:29`는 상태 무관 | 시드는 실제 퇴근 전이(`20260916100000:292`)처럼 `completed`로; 급여 카드에 "완료 외 상태 N건(지각·승인 대기) 제외 — 근태 내역에서 확정" 한 줄 |
| P1 | 지급 대기 동선 | 홈 '7월 급여 1건' → `/payroll?month=2026-07`가 **직원 급여 탭**(김민서·박서윤 0일 0시간, 월급 전액, 지급 예정 6,140,000)으로 열려 실제 대기 1건(공고 지원 인력 · 데모약사 02 · 140,000 · 지급 승인)이 보이지 않음. 약국 시연도 동일 '7월 급여 1건' | `app/payroll/page.tsx:49` 기본 탭이 계산된 draft 행(`staffTodo`)을 우선 | `pendingWageMonth` 링크에 저장된 대기 건이 있는 탭(`&tab=shift`)을 붙이거나, 기본 탭은 '저장된 draft/approved' 기준 |
| P1 | 시드 금액 공식 | 약사 시연 `/shifts` 09:00–13:00 · 38,000원 → **₩152,000**; 관리자가 같은 조건으로 올리면 **133,000**(휴게 30분). 라이브데모 공고도 40,000×4h=160,000, 16,000×5h=80,000(공식은 72,000) | `20260804120000_demo_pharmacy_staff_account.sql:105`, `20260730100000_demo_pharmacy_automation.sql:135`, `20260814104000_expand_live_demo_to_six_workers.sql:36,45` 하드코딩 | SQL 시드도 `calcEstimatedShiftPay`와 같은 식으로(또는 TS 재시드에서 PATCH) |
| P2 | 월급 근태 0일 | 7월 급여: 상시 직원 2명 '완료 근태 0일 0시간'인데 세전 예상액 3,200,000·2,800,000, 지급 예정 6,140,000에 포함 | `lib/db/payroll.ts:56` 계약 겹침만 검사, `:62` 월급은 rate 그대로 | 근태 0일 월급 행은 '근태 없음 · 확인 필요' 배지 또는 합계 제외(정책 결정) |
| P2 | 요금 계산기 입력 | 인원 select가 10·30·50·'50명 초과'뿐이라 정책 예시 '25명 14일'을 직접 못 넣고, '11명이면 30명 구간' 규칙을 사용자가 스스로 적용해야 함 | `app/membership/UsagePricing.tsx:24` | 숫자 입력 + "→ 30명 구간" 자동 표시(`temporaryTier`가 이미 있음) |
| P2 | 권한 기준 불일치 | 긱 지급 기록은 operator 가능, 직원 급여 승인은 owner/super만 | `gig-pay/actions.ts:25` vs `payroll/actions.ts:7` | 의도 확인 후 문서(권한 안내 문구)에 반영 |
| P2 | 시연 급여 승인 잔존 | 시연 사업장은 마감·전월 검사 없이 급여 승인 가능 → 7월 '데모약사 02' 140,000이 '지급 승인' 상태로 남아 매일 홈 '지급 대기 1건' 표시 | `payroll/actions.ts:25`, `payroll/page.tsx:83`; revive가 LIVE-SALES-DEMO instruction 미정리 | reset/revive에 시연 instruction 상태 복원 추가 |
| P2 | 문구 | '단기 알바 근태'(`login/page.tsx:24`), '워커 앱'·'긱워커' 노출 약 50곳(`login/page.tsx:182,216`, `facility-mode.ts:57`, `membership/page.tsx:74`, `more/page.tsx:19`, `checkin/page.tsx:98`, worker `intro/page.tsx:30,40`, `demo/page.tsx:40,73-74`, `worker-intro/page.tsx` 등), 격식체 `sites/page.tsx:10` `SiteOperationsSummary.tsx:8` | — | '단기·행사 근무'·'근무자/단기 근무자'·해요체 |

## 사용자 결정 필요
1. **10/20 #2 결제 가드** — 토스 신청 전에 `assertNotDemoFacility` 2곳 + 버튼 `isDemo` 숨김 + revive 정리. 지금은 키가 없어 UI에서는 못 누르지만 API는 열려 있음.
2. **근태 0일 월급 전액 노출** — 계약 기간 안이면 월급 전액이 맞는지, 근태 0일은 확인 요청으로 둘지.
3. **긱 지급 operator 허용** — 직원 급여(owner/super)와 다른 기준을 유지할지.
4. **시연 급여 승인 흔적** — 7월 '지급 승인' instruction을 reset 대상에 넣을지(매일 홈에 '지급 대기 1건'이 뜨는 원인).
5. **요금 계산기 인원 직접 입력** — 영업 시연에서 '25명' 같은 실제 인원을 그대로 넣게 할지.
6. (10/20에서 이월) 의료 `/membership`·`/staff` 한도 카드 유지 여부, 추가 공고 addon을 전 유료 플랜에 둘지, paid 지급 기록 정정 절차.

## 잘 된 점 (3개)
1. **10/14 P0 두 건이 정확히 닫혔다** — 홈·운영·급여가 같은 달(7월)을 가리키고, 9월 합계에서 일할 전 월급을 빼며 '일할계산 전 1명 제외' 배지로 이유까지 보여 준다(`operations.ts:376-379`, `payroll/page.tsx:45-55`).
2. **v9.1 계산기는 9케이스 전부 정책·테스트와 일치**하고 표시 전용이 유지된다(fetch·액션 없음, 한도·청구 불변). 10/20에 지적한 '복수 현장' 누락과 '두 기준이 다르다' 한 줄이 반영됐다.
3. **시연 시드의 TS 이관 효과** — 병원·요양 공고 예상액이 관리자 공식(₩101,500)과 일치하고 `checked_in_at`도 채워져 근무지 화면 불일치가 사라졌다. 탈퇴·사업장 닫기·설정 변경은 UI와 RPC 양쪽에서 계속 막혀 있다.
