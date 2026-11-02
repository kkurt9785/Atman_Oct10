# HARAGURI — 아이폰 결제 알림 수집(단축어) 작업 지시서
작성 2026-11-02 · 레포 `~/atman/apps/haraguri` · 운영 https://haraguri.vercel.app · 배포 `vercel deploy --prod --yes` (push 아님)

## 0. 현재 상태 (검증 완료)
- 단축어 `하라구리 알림 수집`(토큰 없음, 알림 트리거 + Stored Content 페어링)이 사용자 iPhone(iOS 27.2)에 설치·자동화 켜짐. iCloud 공유 링크 **https://www.icloud.com/shortcuts/273c25287f24405b913d5237fd9f5168** → `python3 scripts/inspect-icloud-shortcut.py <링크>`로 확인: 애플 서명 APPROVED, `WFNotificationTrigger` 1개(앱 10개 보존), 토큰 없음. **iCloud 링크는 트리거를 보존한다 → Mac `shortcuts sign`(macOS 26.x는 트리거 삭제) 더 이상 불필요.**
- 계정 연결(페어링)은 아직 미완. 원인 2개 중 1개만 고침:
  1. ✅ `lib/shortcuts.ts` `shortcutPairingURL`: 이름을 `URLSearchParams`('+')로 넣어 iOS가 못 찾던 것 → `encodeURIComponent`(%20)로 수정·배포·커밋(8dbdbd6).
  2. ❌ **한글 정규화**: 파일(Safari 다운로드→파일 앱)로 설치된 단축어 이름이 NFD(자모 분리, 21 code points). 앱은 NFC(8자)로 `shortcuts://run-shortcut?name=` 호출 → "단축어를 찾을 수 없습니다". 사용자 임시 조치 = 폰에서 이름 지우고 키보드로 재입력(NFC).
- 기존 `하라구리 앱 알림 2`(개인 토큰 내장)가 실제 수집 중이라 서비스 공백 없음. 새 단축어는 연결 전까지 알림마다 "먼저 계정 연결" 팝업.
- 테스트: `npx vitest run`(127+), `cd scripts && python3 -m unittest -q test_notification_shortcut`(13), `npx tsc --noEmit`. 모두 통과 상태에서 시작.

## 1. 작업 목록 (우선순위순)

### T1. 이름 정규화에 안전한 단축어 호출 (필수)
- 대상: `lib/shortcuts.ts`(`shortcutPairingURL`), `components/ShortcutConnect.tsx`(`open-shortcut` 링크).
- 방법 A(권장): `shortcuts://x-callback-url/run-shortcut?name=<NFC>&input=text&text=<code>&x-error=<앱 URL>` 사용. `x-error`로 돌아오면(쿼리 `?pairRetry=nfd&code=…`) 같은 코드로 `name=<NFD>` 버전을 한 번 더 연다. 코드는 5분·1회용이므로 **첫 호출이 실패했을 때만** 재시도(성공 후 재시도 금지).
- 방법 B(보조): 설치 안내와 iCloud 템플릿 이름을 NFC로 통일하고, 빌더/검사 스크립트가 NFD면 경고.
- `scripts/inspect-icloud-shortcut.py`에 `name NFC/NFD` 표시 추가.
- 테스트: `lib/shortcuts.test.ts`에 (a) `%20` 인코딩, (b) x-error 포함, (c) NFD 재시도 URL 생성, (d) 재시도는 1회만 — 4건 추가.

### T2. 설치 카드 정리 (`components/ShortcutConnect.tsx`, `components/ShortcutFileInstall.tsx`, `app/shortcuts/page.tsx`)
- 1단계 "단축어 추가"를 **iCloud 링크 한 번 열기**로 교체(`https://www.icloud.com/shortcuts/<id>`; 매니페스트 `public/haraguri-notifications.json`에 `icloud_url` 필드 추가, `lib/shortcuts.ts` `parseShortcutRelease`가 읽음). 파일 공유(`navigator.share`)·AEA1 검사·"파일로 받아 추가하기"는 제거하거나 접어 둔 폴백으로.
- 2단계 버튼 이름 `단축어를 추가했어요` → `내 계정 연결 시작`. 코드 발급 뒤 `내 계정 연결`로 바뀌는 현재 동작 유지.
- 연결 완료(`initialized`)면 카드 전체를 "연결됨 ✓ · 단축어 열기" 한 줄로 축소. 설치 안 한 사용자에게만 1단계 표시.
- 이미 설치한 사용자가 1단계를 눌러 같은 단축어가 또 뜨는 혼란 제거(사용자 피드백).
- 앱 선택 단계 안내에 한국 은행·카드 앱 아이콘 그림(토스·KB Pay·신한·현대·삼성·우리WON·NH·카카오페이·네이버페이) — "쓰는 앱만 누르세요".

### T3. 자동 페어링 (앱 버튼 단계 제거)
- `scripts/build-notification-shortcut.py`의 "저장된 주소 없음" 분기: `showresult("먼저 하라구리에서…")` 대신 `URL 열기 https://haraguri.vercel.app/pair`.
- 새 페이지 `app/pair/page.tsx`: 로그인·가족 확인 → `hg_create_shortcut_pairing` RPC → 즉시 `shortcuts://x-callback-url/run-shortcut?name=…&input=text&text=<code>`로 이동(T1 재시도 포함). 미로그인이면 로그인 후 같은 흐름.
- 결과: 설치 후 **첫 은행 알림 한 번**으로 연결 완료. 사용자 흐름 = 링크 탭 → 추가 → 앱 고르기·자동화 켬 → (첫 알림 때 허용 1~2회).
- 빌더 출력물은 iOS 27 폰에 추가 → 알림 카드·앱 선택 → **iCloud 링크로 재공유**(Mac 서명 금지). `SelectedApps`는 list 또는 dict 둘 다 허용하도록 `source_notification` 수정.
- 템플릿을 공개용으로 만들 땐 작성자의 은행 앱 선택이 그대로 실리므로 앱을 비운(또는 메시지 앱 1개만) 사본으로 공유.

### T4. 보안 다듬기
- 수집 토큰을 URL 쿼리(`?token=`) 대신 헤더 `x-ingest-token`으로(ingest 함수는 이미 둘 다 받음). 단축어 템플릿의 `downloadurl` 동작에 헤더 추가, Stored Content엔 토큰만 저장.
- 기존 `?token=` 주소는 당분간 호환 유지.

### T5. 정리
- 라이브러리 복제본 `하라구리 알림 수집범ㅇ` 삭제(폰), 미추적 `public/haraguri-notification-test.shortcut` 삭제(레포).
- 연결 성공 후 옛 `하라구리 앱 알림 2` 자동화 끄기(이중 전송 제거; 지문으로 중복은 이미 걸러짐).
- `README.md` "아이폰 카드앱 푸시" 절을 iCloud 링크 흐름으로 갱신, "macOS 27 서명 필요" 문구 삭제.

## 2. 하지 말 것
- 운영 배포·`supabase db push`·Edge Function 배포는 사용자가 실행(에이전트 자동 승인이 막힘). 비밀값(토큰·서비스 키) 출력·커밋 금지.
- 사용자 폰의 `하라구리 앱 알림 2`(토큰 내장)는 공유·삭제 금지. 공유 링크는 토큰 없는 템플릿에서만.
- `.shortcut` 파일 서명 경로(`shortcuts sign`)를 다시 살리지 말 것 — iCloud 링크가 정답.
- 한 줄에 여러 필드가 있는 코드 끝에 `//` 주석 붙이지 말 것(10/28 실사고). 함수 수정 뒤 `node scripts/verify-supabase.mjs`로 "duplicate message ignored"까지 확인.

## 3. 검증 체크리스트
- [ ] `npx vitest run` · Python 13 · `tsc` 통과
- [ ] 새 iPhone(또는 단축어 삭제 후)에서: 링크 탭 → 추가 → 앱 선택·자동화 켬 → 첫 알림 → 앱 열림 → 연결 완료 → 수신함에 `ios-notification` saved 1건
- [ ] 이름이 NFD인 기존 설치본에서도 연결 성공(T1)
- [ ] `inspect-icloud-shortcut.py`로 재공유 링크: 트리거 1·토큰 없음·NFC
- [ ] 연결 뒤 옛 단축어 끄고 하루 동안 결제 2건 이상 자동 저장 확인

## 4. 참고
- 선례: Spenvo(iOS 27 알림 트리거 iCloud 링크 배포, https://spenvo.app/setup/), Finny Notification Log, Deflector. FinanceKit은 미국·영국만. 한국 Apple Pay 거래 트리거는 현대카드만.
- 메모리 정본: `~/.claude/projects/-Users-kihankim-atman/memory/haraguri-family-app.md`
