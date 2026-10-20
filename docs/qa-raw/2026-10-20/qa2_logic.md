# QA2 로직(기술 결함) 검토 — 2026-10-19 작업분 (HEAD 9315694 + 미커밋)

검토일 2026-10-20 · 저장소 `~/atman` · 저장소 파일 수정·커밋·배포·운영 쓰기 없음. 모든 브라우저 QA는 transport mock.

## 요약 (3줄 이내)
- 자동 지표 전부 통과: typecheck 2/2, vitest 33파일·244테스트, `next build` 2/2(경고 0), 저장소 QA 스크립트 6/6 PASS. **P0 없음.**
- P1 1건: `DemoLaunchPanel` 공유 버튼의 clipboard 실패 폴백 안내 문구가 QR 열림 effect에 즉시 지워짐(브라우저 재현으로 확인). 나머지는 P2(문구·방어·정리·성능) 12건.
- 회귀 위험은 "데모 진입 시 무조건 signOut 제거"로 인한 같은 origin 다른 탭 세션 교체, 알림 목록 클릭이 항상 이동하는 변경, FacilitySwitcher 상시 노출 등 — 아래 표 참고.

## 자동 지표
| 항목 | 명령 | 결과(통과/실패 수, 종료코드) | 비고 |
|---|---|---|---|
| worker typecheck | `cd ~/atman/apps/worker-web && npm run typecheck` (`tsc --noEmit`) | 통과, exit 0 | 출력 없음 |
| admin typecheck | `cd ~/atman/apps/admin-web && npm run typecheck` (`tsc --noEmit`) | 통과, exit 0 | 출력 없음 |
| vitest (worker) | `cd ~/atman/apps/worker-web && npx vitest run` | **Test Files 33 passed / Tests 244 passed**, exit 0 (1.05s) | admin-web에는 `test` 스크립트·vitest 설정이 없음. admin 로직(`notification-destination`, `read-all-rows`, `gig-operations`, `gig-payouts`, `pricing-proposal`)은 worker-web 테스트가 `../../../admin-web/...` 상대 import로 검사 |
| lint | — | **건너뜀** | 양쪽 package.json에 `lint` 스크립트 없음, eslint 설정 파일 없음 |
| worker build | `cd ~/atman/apps/worker-web && npx next build` | 성공, exit 0, 경고 0 | `/intro ○ static 5.09kB`, `/demo ○`, `/gig/demo ○`, `/workplace ○ 9.83kB`, `/workplace/join ○`. `useSearchParams`/Suspense 경고 없음. `.next/static/css/a59086efe0525d7b.css` 생성 |
| admin build | `cd ~/atman/apps/admin-web && npx next build` | 성공, exit 0, 경고 0 | 전 라우트 ƒ dynamic(`force-dynamic`) |
| qa-demo-launch | `cd ~/atman && node scripts/qa-demo-launch.mjs <pw>` | PASS 4/4, exit 0 | 360/390/1024px 6개 데모 경로·설치 origin·QR 갱신 + 역할 전환 후 install 이벤트 유지 |
| qa-worker-install-ui | `node scripts/qa-worker-install-ui.mjs <pw>` | PASS 2/2, exit 0 | 빌드 후 실행. 1회성 prompt·오류 복구·iPadOS·인앱 iPhone·dialog |
| qa-admin-install-ui | `node scripts/qa-admin-install-ui.mjs <pw>` | PASS 4/4, exit 0 | native/failure/kakao/ipad |
| qa-admin-entry-flow | `node scripts/qa-admin-entry-flow.mjs <pw>` | PASS 5/5, exit 0 | hospital/pharmacy/care/gigworker 진입 순서(`demo-login→admin-session→set-facility`), 더블클릭 잠금, set-facility 503 시 정리(session 1·signOut 1·calls 4), 실계정 confirm 취소, 재시도 |
| qa-worker-recovery-ui | `node scripts/qa-worker-recovery-ui.mjs <pw>` | PASS 14/14, exit 0 | 360/390 × (workplace 재시도·shift 출퇴근·staff/QR 현장 충돌·초대 재시도·gig 초대·QR fail-closed·데모 confirm/재시도/복귀) — LA 타임존으로 실행 |
| qa-linked-install | `node scripts/qa-linked-install.mjs <pw>` | PASS 4/4, exit 0 | real/demo/installed/no-invite |
| (추가) 검토자 프로브 | `node <scratchpad>/atman-qa/probe-demo-launch-panel.mjs` | 아래 "발견 사항 1" 근거 | 저장소 밖 스크립트, 동일 mock 방식 |

`<pw>` = `/Users/kihankim/lumenix/main/node_modules/playwright-core` (1.60.0). Chrome 155.0.8059.85, esbuild 0.28.2(worker-web node_modules). 글로벌 playwright-core 없음. 포트 3002/3003 리스너 없음 확인 후 빌드(3001은 다른 프로젝트 `next dev`).

프로브 원문 출력:
```
A clipboard-fail fallback message after QR opens: "" (expected to contain '길게 누르거나') errors=[]
B control (QR pre-opened): "아래 주소를 길게 누르거나 선택해서 복사해 주세요."
C clipboard-ok: "선택한 시연 링크를 복사했어요."
D ?role=WORKER&kind=HOSPITAL -> start href=https://admin.itdot.co.kr/login?demo=hospital adminPressed=true errors=[]
D ?role=worker&kind= -> start href=/demo adminPressed=false errors=[]
D ?role=&kind=gigworker -> start href=https://admin.itdot.co.kr/login?demo=gigworker adminPressed=true errors=[]
D ?role=worker&kind=pharmacy -> start href=/demo adminPressed=false errors=[]
D ?role=admin&kind=unknown -> start href=https://admin.itdot.co.kr/login?demo=hospital adminPressed=true errors=[]
```

## 발견 사항
P0=빌드·타입·테스트 실패, 시연 진입 불가, 데이터 오염/무한 루프 · P1=특정 조건에서 기능 결함 · P2=방어 코드·정리

| 우선순위 | 화면/모듈 | 현상(재현 순서) | 원인(파일:줄) | 기대/수정 방향 |
|---|---|---|---|---|
| **P1** | worker `/intro` DemoLaunchPanel · 공유 | ① clipboard가 없는 환경(HTTP, 카카오톡 등 인앱 브라우저에서 `navigator.share` 없음+clipboard 거부)에서 "선택한 시연 공유" 탭 ② QR 패널과 주소칸은 열리지만 안내 문구(`role=status`)가 **빈 문자열**. 프로브 A 재현, B(QR을 먼저 연 상태)에서는 문구 유지 → effect가 지운 것 확정 | `apps/worker-web/app/intro/DemoLaunchPanel.tsx:32-38` 에서 `setMessage('아래 주소를 길게…')` + `setQrOpen(true)` 가 한 배치로 렌더 → `:15-21` effect(`deps [url, qrOpen]`)가 `qrOpen` 변경을 보고 `setMessage('')` 실행 | effect에서 `setMessage('')`를 `url` 변경 시에만 수행(effect 분리) 또는 `share()` 폴백에서 `setQrOpen(true)` 뒤 문구를 세팅. 인앱 브라우저가 이 링크의 주 유입 경로라 조건이 드물지 않음 |
| P2 | worker DemoSelection · SSR 초기값 | `?role=worker&kind=gigworker`로 열어도 SSR HTML과 첫 페인트는 `admin/hospital` 상태(`설치 없이 시연하기` href가 `https://admin.itdot.co.kr/login?demo=hospital`). hydration 후 effect로 교정되므로 hydration 오류는 없음(프로브 errors=[]), 다만 JS 실행 전(느린 인앱 브라우저 수 초) 탭하면 관리자 데모로 감. 또 `role=WORKER`, `kind=HOSPITAL` 등 대소문자는 무시되어 기본값(프로브 D) | `apps/worker-web/app/intro/DemoSelection.tsx:20-27` (`useState` 기본값 후 `useEffect`에서 `window.location.search` 파싱, 대소문자 구분 `===`) | 정적 페이지 유지가 목표라면 마운트 전까지 CTA를 비활성/`aria-busy`로 두거나, 파싱 시 `toLowerCase()` 적용. `useSearchParams`를 쓰지 않아 Suspense 경계는 불필요(빌드 경고 없음) |
| P2 | worker DemoSelection/DemoLaunchPanel · 하드코딩 origin | 로컬·프리뷰 빌드의 `/intro`에서도 관리자 데모·설치 링크가 운영 `https://admin.itdot.co.kr`로 감. admin 쪽은 반대 방향에 `NEXT_PUBLIC_WORKER_WEB_URL`을 씀 | `DemoSelection.tsx:28,45`, `DemoLaunchPanel.tsx:67` (공유 URL `:13`은 운영 고정이 의도일 수 있음) | `NEXT_PUBLIC_ADMIN_WEB_URL` 같은 env로 분기(admin `app/page.tsx` 패턴과 대칭) |
| P2 | worker demo-session · 단일 비행 키 없음 | ① `/demo`에서 "간호사 시작" 탭(버튼들은 disabled) ② 응답 전(1~2초) 하단 "초대받은 단기 근무자" `Link`(disabled 아님)로 `/gig/demo` 이동 ③ "시연 계정으로 시작" 탭 → `openingDemo`가 첫 비행(의료)을 그대로 돌려줘 `/home`으로 이동(초대 수락 화면 아님) | `apps/worker-web/lib/demo-session.ts:43-48` — 비행이 `target`과 무관하게 공유됨. 프라미스 초기화는 `.finally`로 reject/resolve 모두에서 정상(`:46`), 재시도 가능 확인(스크립트·테스트) | 비행에 target 키를 두고 다른 target 요청은 reject 또는 대기 후 재시도. 확률 낮음 |
| P2 | worker demo-session · confirm 취소가 "오류"로 표시 | 실계정 로그인 상태에서 데모 카드 탭 → confirm 취소 → `/demo`·`/gig/demo`에 빨간 `role=alert` "시연 전환을 취소했어요…" | `demo-session.ts:53-55`가 throw → `app/demo/page.tsx:24-26`, `app/gig/demo/page.tsx:25-27`에서 error로 렌더 | 취소는 예외가 아니라 `null` 반환 등으로 구분해 안내(`role=status`)로 표시. 동작 자체(아무 것도 바뀌지 않음)는 정상 — 스크립트가 `preparations=0`, `signOuts+savedSessions=0` 확인 |
| P2 | worker `/workplace` · 오류 문구 덮어쓰기 | ① 홈 CTA `출근하기 · 사업장`(`/workplace?applicationId=X`) 탭 ② 그 사이 지원이 취소/변경돼 목록에 없음 → 화면은 "근태 정보를 확인하지 못했어요. 연결 상태를 확인하고…" + "다시 불러오기"(눌러도 같은 결과). `?staffId=`+`facility=` 불일치(QR 현장 충돌)도 같은 연결 오류 문구 | `apps/worker-web/app/workplace/page.tsx:125`의 구체 메시지와 `:82`의 `'staff unavailable'`가 `:145` `catch`에서 고정 문구로 덮임(구체 메시지는 데드 코드). `WorkAgenda.tsx:60-61`의 id는 `shift_applications.id`로 `selectWorkplaceShift(:9)`와 일치 — 정상 경로는 문제 없음 | `catch(e)`에서 `e.message`를 사용하거나 의도적 차단(현장 불일치·근무 없음)은 별도 state로 분리. fail-closed 자체는 올바름(QA 스크립트 "explicit staff QR conflict" 통과) |
| P2 | worker InstallBanner · 중복 effect | `localStorage` 접근이 throw하는 환경(사생활 모드 등)에서 첫 effect는 `dismissed=true` 유지, 둘째 effect는 `false`로 바꿔 배너가 뜸. 같은 값을 두 번 계산 | `apps/worker-web/components/InstallBanner.tsx:10-19`(update 안 try/catch 무시)와 `:20`(catch→false)이 공존 | `:20` 제거하고 `update()`의 catch에서 정책 하나로 통일 |
| P2 | worker LinkedNotice · 닫기(✕)가 14일 설치 억제 기록 | ① 데모 계정으로 초대 수락 → `/gig`에서 "연결됐어요" 카드(데모라 설치 CTA 없음) ② ✕로 닫음 ③ 데모 종료 후 같은 브라우저에서 실가입 → `InstallBanner`가 14일간 숨겨짐 | `apps/worker-web/components/invite/LinkedNotice.tsx:18-24`(`dismiss`가 항상 `installBannerDismissedAt` 기록) + `:47`(✕도 같은 `dismiss`) → `InstallBanner.tsx:12,23` | 설치 CTA를 실제로 보여준 경우(`demo===false && install.ready && !installed`)에만 dismissedAt 기록, ✕는 notice·`LINKED_INSTALL_KEY`만 정리 |
| P2 | admin FacilitySwitcher · 빈 목록 메시지 | 시설이 0개인 관리자(또는 `/api/facilities`가 빈 배열)로 Shell 헤더가 있는 경로에 오면 "현장 확인 중" + 빨간 "현장 목록을 불러오지 못했어요 · 목록 재시도". 실제로는 '현장 없음'인데 네트워크 오류처럼 보임. `/login`·`/setup/*`은 Shell 공개 경로라 노출 범위는 `/`→setup 리다이렉트 전 등으로 제한 | `apps/admin-web/components/FacilitySwitcher.tsx:33`(`if(!rows.length)throw`) + `:69`(`!current` 조기 return 제거) | 빈 배열은 오류가 아니라 "현장을 추가해 주세요" 상태로 분기 |
| P2 | admin `/notifications` · 항상 이동 | `url`도 `facilityId`도 없는 알림(안내성)을 탭하면 읽음 처리 후 `/`로 이동해 목록을 벗어남(이전엔 목적지 없으면 머묾) | `apps/admin-web/app/notifications/page.tsx:37` (`window.location.href = adminNotificationDestination(row.data)` 무조건) + `lib/notification-destination.ts:15` 기본값 `'/'` | 목적지가 `'/'`이고 `facility`도 없으면 이동 생략(읽음만) |
| P2 | admin read-all-rows / sites 집계 성능 | ① 마지막 페이지가 500행 미만이어도 한 번 더 빈 페이지 조회(호출당 +1 RTT) ② `/sites`는 현장마다 `SiteOperationsSummary`를 순차 await — 현장 N개 × (readAllRows 4~6회×≥2 RTT + 설정 + 권한 RPC) → N에 비례해 페이지 지연, Suspense 경계 없음 | `apps/admin-web/lib/db/read-all-rows.ts:17`(0행에서만 종료) · `app/sites/page.tsx:8` map 안 async 컴포넌트 · `lib/db/site-summary.ts:12-18,37-40` | `rows.length<500`이면 즉시 종료; 현장별 `<Suspense>`로 감싸거나 집계를 한 쿼리/RPC로. 정확성은 문제 없음: 커서 단조성 검사(`:19`)·2000페이지 상한(`:11`)으로 무한 루프 불가, 1001행 테스트 통과, 모든 호출부 select에 `id` 포함 확인(gig-operations 69-83,110 / gig-payouts 55,83,85,115,122 / site-summary 13-16,38-39). uuid 문자열 비교는 소문자 canonical 형식에서 Postgres 순서와 일치 |
| P2 | admin `payroll.ts` · 1000행 제한 잔존(어제 변경 아님, 정책 불일치) | 급여 화면은 여전히 `.limit(1000)`에 초과 감지 없음 → 1000행 초과 시 조용히 잘림 | `apps/admin-web/lib/db/payroll.ts:38-40,106`, `app/api/payroll/export/route.ts:24` | `readAllRows`로 통일(이번 작업 범위 밖이지만 "1000행 제한" 검토 항목에 해당) |
| P2 | admin AdminInstallButton · 인앱 판정 불일치 | Android 일반 WebView(UA `; wv)`)에서 worker는 인앱으로 판정해 외부 브라우저 안내, admin은 "안드로이드 · 크롬 ⋮ 메뉴" 안내(WebView엔 없음) | `apps/admin-web/components/AdminInstallButton.tsx:88` 정규식에 `; wv\)` 없음 vs `apps/worker-web/lib/pwa-install.ts:4` | worker `installPlatform`과 동일 정규식 사용(공유 유틸). admin에는 worker `ClientLayout.tsx:25`식 앱 레벨 `beforeinstallprompt` 선캡처도 없음(현재 `/login` 첫 렌더에 버튼이 마운트돼 실사용 문제는 없음) |
| P2 | admin login `?demo=` · 데모 꺼진 빌드 | `NEXT_PUBLIC_ENABLE_DEMO_LOGIN!=='1'`인 배포에서 intro 링크로 오면 아무 안내 없이 일반 로그인 화면 | `apps/admin-web/app/login/page.tsx:51-56` (`if(!showDemoLogin||!demoParam) return`) | "이 배포에서는 시연이 꺼져 있어요" 안내 한 줄(worker `/demo:77`과 대칭) |
| P2 | admin sw.js · 캐시 버전 질문 | 캐시를 전혀 쓰지 않는 SW(`fetch` no-op)라 "캐시 버전 올림/구버전 정리/오프라인 폴백"은 해당 없음. 파일 바이트가 바뀌어 브라우저가 새 SW 설치 → `skipWaiting`+`clients.claim`으로 즉시 교체. `existing.navigate(url)`는 이 SW가 제어하지 않는 창이면 reject(기존 동작) | `apps/admin-web/public/sw.js:3-6, 34-37` | 그대로 두되, `includeUncontrolled:true`로 찾은 창은 `navigate` 대신 `openWindow` 폴백 고려(기존 이슈) |

검토했지만 결함을 찾지 못한 항목(근거):
- **demo-session**: `openingDemo`는 `.finally`로 성공·실패 모두 null 복귀(`:46`) → 실패 후 재시도 가능(스크립트 "retry" 통과). `getSession` 오류는 throw로 fail-closed(`:52`). confirm 확인/취소 양쪽 스크립트 통과. 뒤로가기 후 재진입은 새 비행(이전 비행 완료 후) → 정상. **탭·앱 간 세션 범위**: admin.itdot.co.kr/itdot.co.kr은 다른 origin → `sb-<ref>-auth-token` localStorage 분리, admin 쿠키(`atman_admin_session`, `admin-auth.ts:111-117`)는 host-only·httpOnly → 두 앱 간 충돌 없음. 같은 origin 두 탭은 아래 회귀 위험 참조.
- **DemoLaunchPanel**: `navigator.share` 거부(비-AbortError)→clipboard→QR 폴백 순서 정상, `navigator.clipboard` undefined도 try 안에서 TypeError로 잡힘(`:32-38`), QR 실패 `.catch` 안내(`:19`). 관리자 링크 `?demo=hospital|pharmacy|care|gigworker`는 admin `DEMO_ACCOUNTS` key(`login/page.tsx:20-25`)와 1:1 일치, `gigworker`→`sales-demo-1`+`demoKind`→`set-facility`가 팝업스토어 데모 시설로 고정(`route.ts:36-44`) — 역할·유형 일치.
- **pwa-install**: prompt를 `event.prompt()` 호출 전에 `null`로 소비(`pwa-install.ts:17`)해 재사용 불가, 수락≠설치(`pending`), `appinstalled`로만 `installed`(`:14,18`), 컨트롤러 구독 해제(`:29-33`), window 리스너는 모듈 1회 등록(`:25,31` — 앱 수명 동안 1개, 누수 아님), `window`/`navigator` 접근은 모두 effect 안(SSR 안전). iOS/iPadOS(`maxTouchPoints>1`)/인앱 분기 테스트 7개 통과.
- **linked-install/JoinInvite/LinkedNotice/workplace-selection**: 키 `atman_linked_notice`·`atman_linked_install`(session) / `installBannerDismissedAt`·`atman_demo_panel`·`atman_auth_next`·`atman_gigworker_mode`(local) 충돌 없음. 초대 수락→`/gig`·`/workplace` 양쪽에 `LinkedNotice` 마운트 확인(`app/gig/page.tsx:207`, `app/workplace/page.tsx:191`). `leaveDemo`가 `atman_demo_panel`·긱 모드 정리(`demo-session.ts:87-88`). 선택 로직 테스트 7개 통과, 명시 `staffId`/`applicationId`는 다른 현장으로 대체하지 않음(`workplace-selection.ts:2-13`).
- **AuthGuard/set-facility/AdminDemoBar**: `demoKind` 전달 확인(스크립트 `calls[2].body.demoKind`). set-facility 실패 시 login이 `switched` 플래그로 서버 세션 DELETE+local signOut 후 오류 표시·재시도 가능(`login/page.tsx:128`, 스크립트 통과). `signOut({scope:'local'})`은 공용 데모 계정의 refresh token을 서버에서 폐기하지 않아 **다른 방문자 기기의 데모 세션을 끊지 않음**(의도에 부합). 리다이렉트 루프: `/notifications/open`→(세션 없음)→pending 저장→`/login`→로그인→`/`→pending→`/notifications/open`→권한 403이면 오류+재시도로 종료, pending은 1회 소비(`AuthGuard.tsx:39-41`) → 루프 없음. 데모 로그인은 pending 제거(`login/page.tsx:107`).
- **notification-destination/open**: 허용 경로 화이트리스트 + `/notifications/open` 재귀 차단(`notification-destination.ts:14-15`), `//`·`\`·제어문자·절대 URL 차단(`shared/notifications/navigation.ts:4-7`), `%61pi` 등 인코딩 우회는 디코딩 없이 비교되어 차단(테스트 11개). SW가 만든 `next`도 open 페이지에서 재검증(`open/page.tsx:22`) → 외부 오픈 리다이렉트 불가. `facility` 없음→오류+`/sites` 링크, `/api/facilities` POST가 접근 권한 검증(403, `api/facilities/route.ts:27-29`).
- **site-summary 집계**: `default_start_time`은 NOT NULL DEFAULT '09:00'(`20260723110000_clinic_workforce_lite.sql:18`), `gig_assignments.start_time` NOT NULL → `minutes()` null 크래시 없음. 요일 `getUTCDay()||7`은 1=월…7=일로 `work_weekdays` 규약(JoinInvite WEEKDAYS)과 일치. 권한 없으면 `unpaid=null`→"권한 없음" 표기, 집계 실패는 0으로 표시하지 않고 안내(`SiteOperationsSummary.tsx:8`).

## 회귀 위험 (어제 변경이 기존 흐름을 깨는 지점)
1. **데모 진입 시 무조건 `signOut()` 제거**(`demo-session.ts:51-66`): 같은 origin(itdot.co.kr)에서 실계정으로 작업 중인 **다른 탭**이 있으면, 한 탭에서 confirm 후 데모 진입 시 `setSession`이 localStorage 세션을 교체 → 다른 탭도 `onAuthStateChange`로 데모 계정이 되어 DemoBar가 뜨고 작업 맥락이 바뀜(이전엔 signOut으로 둘 다 로그아웃되던 것이 '둘 다 데모'로 변경). confirm 문구가 경고하므로 수용 가능하나 인지 필요. 실계정 refresh token은 서버에서 폐기되지 않음(세션 '교체'이지 '로그아웃' 아님).
2. **admin 알림 목록 클릭이 항상 이동**(`notifications/page.tsx:37`): 목적지 없는 알림도 `/`로 이동(위 P2).
3. **FacilitySwitcher 상시 렌더**(`FacilitySwitcher.tsx:69`): 시설 없는 상태의 헤더에 오류성 문구(위 P2). `layout.tsx:39-44`가 `initialFacility`를 서버에서 주입해 첫 페인트는 개선됨.
4. **`getGigOperationsBoard` 근태 조회에서 `.in('staff_id',staffIds)` 제거**(`gig-operations.ts:79-80,110-111`): 종료 직원의 근태도 읽어오지만 `workers`는 `staffRows` 기준이라 결과엔 영향 없음(추가 데이터만). `pay` 요약이 `unpaidDays>0` 기준으로 바뀌어(`:178`, `GigOperationsBoard.tsx:26`) 이전 `status` 기준과 수치가 달라질 수 있음 — 테스트가 새 정의를 고정.
5. **`getGigPayoutBoard.openToday`**가 `work_date=today`에서 `status in (working,late,checkout_pending)`로 확대(`gig-payouts.ts:115`): 야간 근무 포함은 의도, 다만 `checkout_pending`(승인 대기)도 '퇴근 전'으로 취급돼 "퇴근 뒤 지급" 안내가 더 자주 뜸.
6. **InstallBanner 노출 조건에 `linkedInstall`(30분) 추가**(`InstallBanner.tsx:13,23`)와 LinkedNotice의 14일 dismissedAt 기록이 겹쳐, 초대 수락 경로에서는 일반 설치 배너를 사실상 보기 어려움(의도된 중복 방지로 보이나 위 P2의 데모 케이스 포함).
7. **admin `app/layout.tsx:39`에서 `getAdminContext()` 추가 호출**: `/login` 등 공개 경로에서도 실행되지만 쿠키 없으면 즉시 null, 예외는 `.catch(()=>null)` → 안전. `FACILITY_COOKIE_SECRET` 미설정 환경에서도 레이아웃이 죽지 않음.
8. **admin 로그인 `?install=1` 인앱 자동 외부 브라우저 전환 제거**(`login/page.tsx` diff): 카카오톡에서 설치 링크를 열면 이제 사용자가 버튼을 눌러야 전환 — 스크립트 `assert.equal(page.url(), …install=1)`로 고정된 의도적 변경.

## 잘 된 점 (3개 이내)
1. **설치 컨트롤러 설계**(`lib/pwa-install.ts`): 1회성 `beforeinstallprompt`를 호출 전에 소비하고, '수락'과 '설치됨'을 분리하며, UI 두 곳이 동시에 눌러도 prompt 1회만 — 단위 테스트 7개 + 실제 Chrome 스크립트로 이중 검증.
2. **데모 진입 안전장치**: worker는 준비 실패 시 실제 사용자를 로그아웃시키지 않고(`demo-session.ts:56`), admin은 `switched` 플래그로 부분 성공(세션만 생성, 시설 실패)을 되돌리며(`login/page.tsx:128`), `set-facility`가 잘못된 현장으로 떨어지는 대신 503으로 막음(`route.ts:42-54`) — 모두 mock 스크립트로 재현 검증.
3. **읽기 모델의 fail-closed**: `readAllRows`가 중간 오류·커서 역행을 부분 성공으로 처리하지 않고(`read-all-rows.ts:15,19`), 알림 목적지는 화이트리스트+이중 검증(SW→open 페이지)으로 오픈 리다이렉트를 차단 — 1001행·위험 URL 8종 테스트 통과.
