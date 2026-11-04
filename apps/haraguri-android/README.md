# 하라구리 알림 (Galaxy companion)

갤럭시에서 카드·은행 앱 알림을 읽어 하라구리 가계부로 보내는 작은 앱. 웹앱(PWA)은 알림을 읽을 수 없고,
아이폰은 iOS 27 단축어 알림 트리거로 해결했지만 안드로이드엔 그런 기본 기능이 없어서 MacroDroid 5단계 설정 대신 이 앱을 둔다.

사용자 흐름: 하라구리 가계부 카드 **갤럭시 앱 설치** → 설치 → **갤럭시 앱으로 연결**(`intent://pair?code=…`) → 앱에서 **알림 접근 허용** → 끝.
앱은 카드·은행·페이·메시지 앱을 자동으로 골라 두고(`AppsActivity.FINANCE`), 사용자가 바꿀 수 있다.

## 구조 (외부 의존성 없음)
- `NotificationListener` — 선택한 앱의 알림을 `{title, body, app, via:"android"}`로 전송(아이폰 단축어와 같은 형식). 그룹 요약·진행 중 알림 제외, 같은 알림 10초 안 재게시 무시.
- `Sender` — 영구 큐 + 단일 스레드 전송, `x-ingest-token` 헤더. 오프라인이면 큐에 남겨 다음 알림·앱 열 때 재전송.
- `Pairing` — 웹앱이 만든 5분 코드로 `shortcut-pair` 함수에서 토큰을 받아 저장, `android-setup` 핑 전송(웹앱 카드에 '연결 테스트 ✓').
- `MainActivity` — 연결·알림 접근·앱 선택·배터리 제외·최근 전송 로그. 딥링크 `haraguri://pair?code=`.
- `Store` — SharedPreferences(token, ingest_url, packages, queue, log).

## 빌드
```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ANDROID_HOME=$HOME/Library/Android/sdk
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
```
`local.properties`에 `sdk.dir`이 필요하다(gitignore). AGP 8.9.1 · Kotlin 2.0.21 · compileSdk 35 · minSdk 26.

## 검증
에뮬레이터나 USB 기기를 붙이고 웹앱 저장소에서:
```bash
node scripts/verify-galaxy-app.mjs            # 임시 계정 → 설치 → 딥링크 페어링 → 가짜 승인 알림 → saved(카페) → duplicate
```
실기기(삼성)에서는 설정 → 배터리 → 절전 예외와 '알림 접근 허용'이 실제로 유지되는지 따로 본다.

## 서명·배포
- 서명 키: `keystore/haraguri-release.jks` + `keystore.properties`(둘 다 gitignore, 이 Mac에만 있음). **분실하면 같은 서명으로 업데이트를 못 하니(기존 설치자는 삭제 후 재설치) iCloud 등에 백업해 둘 것.** 비밀번호는 properties 파일 안에만.
- `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`(키가 없으면 디버그 서명으로 떨어짐). `apksigner verify --print-certs`로 DN `CN=HARAGURI` 확인.
- 배포: APK를 웹앱 `public/haraguri-collect.apk`로 복사 → 웹앱 vercel 배포 → 가계부 카드 **갤럭시 앱 설치**가 그 파일을 연다(설치 시 '알 수 없는 앱' 허용 1회). 업데이트는 `versionCode`를 올리고 같은 절차. Play 스토어는 나중.
