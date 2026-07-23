# 잇닿 구 기능 명세서

> 크레딧·구 정산 흐름이 포함된 과거 구현 기록입니다. 현재 제품 설명에는 사용하지 않습니다.

> 최종 업데이트: 2026-07-12 · 상태 표기: ✅ 구현 · 🟡 부분 구현 · ⏳ 예정

> 신규 금전 흐름은 **병원 직접 임금지급 + 별도 SaaS 청구** 모델이다. 체크아웃은 지급 요청을 생성하며 임금 연동 플랫폼 수수료, 병원 크레딧 차감, 워커 현금성 환급을 만들지 않는다. 기존 원장은 과거 내역 보존용이다.

**구성**: 워커 앱 `itdot.co.kr` (Next.js 15.5.20, PWA) · 관리자 앱 `admin.itdot.co.kr` (Next.js 15.5.20, PWA) · Supabase (Postgres + PostGIS + Auth + Storage)

---

## 1. 인증

| 기능 | 상태 | 비고 |
|---|---|---|
| 카카오 OAuth 로그인 (양쪽 앱) | ✅ | REST API 키 + Client Secret, 인가코드 → 자체 토큰 교환(`/api/kakao-token`) → Supabase `signInWithIdToken` |
| 카카오 인앱 브라우저 우회 | ✅ | `kakaotalk://web/openExternal` 로 외부 브라우저 전환 |
| 데모 계정 로그인 | ✅ | `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=1` + 비프로덕션에서만 노출 |
| 관리자 권한 검증 | ✅ | Supabase 검증 세션 + 사용자에 묶인 서명 facility context + 역할 재검증 |
| PASS 본인인증 | ⏳ | 사업자등록 후 NICE/KCB 계약 |

## 2. 워커 앱

### 2.1 온보딩 (`/onboarding`)
약관 → 직군(간호사/간호조무사) → 활동지역(최대 2개, 반경 설정) → 면허 사진 업로드(스킵 가능) → **본인 정보(실명·생년월일·휴대폰)** → **계좌 등록 후 제출** → 심사 대기

| 항목 | 상태 | 비고 |
|---|---|---|
| 실명·생년월일·휴대폰 수집 | ✅ | 만 18세 미만 차단 (클라이언트 + DB 트리거) |
| 면허 사진 업로드 | ✅ | Storage `license-photos`, 업로드 시 `verification_status='reviewing'` |
| 계좌 수집 (암호화 저장) | ✅ | `pgp_sym_encrypt`, 마지막 4자리만 평문. **실인증(1원)은 오픈뱅킹 계약 후** |
| 제출 실패 처리·중복 제출 방지 | ✅ | 에러 인라인 표시, 버튼 잠금 |

### 2.2 시프트 탐색·지원 (`/home`, `/shifts`)
| 항목 | 상태 | 비고 |
|---|---|---|
| GPS + 지역 이중 매칭 | ✅ | `get_nearby_open_shifts_secure` — `auth.uid()` 기반 직군·활동지역 검증, 현재 위치와 선호지역 합집합 |
| 필터 | ✅ | 날짜/시간대(야간·주간·이른)/시급/부서 칩 |
| 추천 시프트 | ✅ | 조건 맞춤 가로 캐러셀 |
| 지원하기 | ✅ | `apply_to_shift` RPC, 중복·겹치는 확정 근무·자격 상태 검증 |
| 지원 취소 | ✅ | `cancel_my_shift_application` RPC로 본인 대기 지원만 취소 |

### 2.3 근무·정산
| 항목 | 상태 | 비고 |
|---|---|---|
| 체크인용 QR 표시 | ✅ | 서버 발급 무작위 토큰만 포함, 60초 만료·1회 사용 |
| 지원 현황 (`/applications`) | ✅ | 대기/수락/완료 상태별 |
| 적립금·스토어 (`/store`) | ✅ | `user_credits` 잔액 표시 |
| 푸시 알림 | ✅ | Web Push (VAPID) + Service Worker, 매칭 알림 |

### 2.4 PWA
| 항목 | 상태 | 비고 |
|---|---|---|
| 홈 화면 설치 | ✅ | manifest + maskable 아이콘, iOS 안내 배너 / Android 네이티브 프롬프트 |
| 설치 배너 | ✅ | 14일 스누즈, standalone 감지 시 숨김 |

## 3. 관리자 앱

### 3.1 대시보드 (`/`)
| 항목 | 상태 | 비고 |
|---|---|---|
| 이번 달 예상 인건비·근로시간 | ✅ | 오늘 매칭 시프트 기준 |
| 운영 가능 상태 (크레딧 vs 확정근무) | ✅ | 부족 예상 시 추천 충전 티어 표시 |
| 지원 대기 배지 | ✅ | |
| FacilitySwitcher | ✅ | 슈퍼계정(facility_admin_access) 다병원 전환 |

### 3.2 시프트·매칭
| 항목 | 상태 | 비고 |
|---|---|---|
| 시프트 등록 (`/shifts/new`) | ✅ | 직군/날짜/시간/시급/부서 |
| 지원자 수락/거절 (`/applications`) | ✅ | 사용자 JWT + facility 역할 검증 + 트랜잭션 RPC |
| 만료 미매칭 배너 → 다시 올리기 | ✅ | |
| 워커 승인/거절 | 🟡 | 플랫폼 `super` 역할만 전체 면허 심사, 시설 관리자는 지원자 범위만 열람 |

### 3.3 자체 인력풀·운영 자동화
| 항목 | 상태 | 비고 |
|---|---|---|
| 병원 자체 인력풀 (`/workforce`) | ✅ | 지원 수락·근무 이력 기반 자동 등록, 최근 근무·누적시간·자격 만료 표시 |
| 반복근무 직접 요청 | ✅ | 공개 공고와 분리된 워커 지정 초대, 워커 수락 후 병원 최종 확정 |
| 반복 시프트 템플릿 (`/operations`) | ✅ | 요일·시간·직군·필요 인원·시급 저장, 2/4/8주 인원별 일괄 생성 및 중복 방지 |
| 운영 경고·긴급 대체 | ✅ | 48시간 내 미충원 알림 재전송, 출근 30분 경과 노쇼 대체 공고, 자격 만료·지급 대기 표시 |
| 월 예상 인건비 | ✅ | 당월 취소 제외 전체 시프트 예정액 합산 |
| 지급 검토 CSV | ✅ | 소유자·슈퍼 권한 전용, 계좌번호 끝 4자리만 포함 |

### 3.4 QR 체크인/체크아웃 (`/checkin`)
관리자 기기 카메라로 워커 QR 스캔 → 체크인/아웃 토글

| 항목 | 상태 | 비고 |
|---|---|---|
| QR 스캔 (jsQR) | ✅ | DB 토큰 해시·TTL·1회 사용·시프트 상태 검증 |
| **GPS 지오펜스** | ✅ | 스캔 기기 위치 vs 병원 좌표, **500m 초과 거부**, `check_in/out_location`·`distance_m` 기록. 지오펜스 필수 시설은 GPS 누락도 거부 |
| 자동 임금 계산 | ✅ | 기본급 + 연장(8h 초과 +50%) + 야간(KST 22~06시 +50%), 휴게시간 차감, `wage_calculations` 기록 |
| 크레딧 자동 차감 | ✅ | `consume_attendance_qr` 단일 트랜잭션에서 임금·수수료·크레딧·근태·원장 갱신 |
| 서버 1회용 QR 토큰 | ✅ | 무작위 bearer token, DB에는 해시만 저장, 60초 TTL, `FOR UPDATE` 소비 |

### 3.5 근태·급여
| 항목 | 상태 | 비고 |
|---|---|---|
| 근태 보기 (`/timesheet`) | ✅ | |
| 급여명세 (`/payroll`) | ✅ | wage_calculations 기반, 세후 계산. 포괄임금 금지(2026) 대응 항목별 산출 |

### 3.6 멤버십·크레딧 (`/membership`)
| 항목 | 상태 | 비고 |
|---|---|---|
| 크레딧 티어 | ✅ | 50만~1,000만, Toss 3.4% 수수료 반영 흑자 구조 (마진 2~3.6%) |
| 토스페이먼츠 결제 | 🟡 | 서버 주문 원장 → 승인 검증 → webhook/cron 재조회 → 멱등 크레딧 지급. 운영 키 전환 전 Toss 샌드박스 장애 테스트 필요 |
| 크레딧 원장 | ✅ | `credit_ledger` (earn/spend), 유효기간 1년, 보너스 환불 불가 정책 |

## 4. 백엔드 (Supabase)

| 영역 | 내용 |
|---|---|
| 핵심 테이블 | `workers`, `facilities`, `shifts`, `shift_applications`, `shift_attendances`, `wage_calculations`, `wage_payment_instructions`, `facility_worker_pool`, `shift_templates`, `worker_location_prefs`, `facility_admin_access`, `profiles` |
| 위치 | PostGIS `geography(POINT,4326)` — 워커 활동중심/병원 위치/체크인 위치, GIST 인덱스 |
| RPC | `get_nearby_open_shifts_secure`, 지원·수락·QR·정산·결제·환급 RPC |
| 보안 | 사용자 경로는 JWT/RLS/RPC, service_role은 결제·outbox 등 서버 전용, 민감 Storage private, 계좌 암호화 키 fail-closed |
| 정산 규칙 | `rule_version='2026-KR'` — 최저시급 10,320원, 연장/야간 +50%, 휴게 자동 차감 |

## 5. 시연·운영

| 항목 | 내용 |
|---|---|
| 데모 되살리기 | `python3 scripts/revive_demo.py` — 슈퍼계정 3개 + 당일 시프트 100개(확정50/모집50) 재생성. **시연 전날 실행** |
| 데모 계정 | sales-demo-1/2/3@demo.atman.co.kr (데모 로그인은 로컬 dev에서만 노출) |
| 배포 | `npx vercel --prod` (각 앱 디렉토리) — GitHub 자동배포 미작동 |
| 로컬 포트 | admin 3002 / worker 3003 (카카오 리다이렉트 URI 등록됨) |

## 6. 외부 의존 대기 목록

1. **사업자등록** → 토스페이먼츠 전자결제(크레딧 실결제) · NICE/KCB PASS(본인인증) · 오픈뱅킹(계좌 1원 인증)
2. **앱스토어** — PWA 우선 전략, 사용자 확보 후 RN WebView 등록 검토
