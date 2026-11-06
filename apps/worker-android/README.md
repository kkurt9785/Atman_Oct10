# 잇닿 근무자 안드로이드 앱 (TWA)

`https://itdot.co.kr` 근무자 웹앱(PWA)을 Google Play 에 올리기 위한 안드로이드 껍데기예요.
앱 안에서는 크롬이 사이트를 그대로 띄워요(Trusted Web Activity). 웹을 배포하면 앱 내용도 바로 바뀌어요.

| 항목 | 값 |
|---|---|
| 패키지 이름 | `kr.co.itdot.worker` — **Play 에 한 번 올리면 영원히 못 바꿔요.** `twa-manifest.json` 의 `packageId` 한 곳에서만 정해요. |
| 이름 | 앱 이름 `잇닿 근무자`, 홈 화면 아이콘 이름 `잇닿` |
| SDK | compileSdk·targetSdk 36, minSdk 24 (androidbrowserhelper 2.7.4 가 24 이상을 요구해요) |
| 권한 | `POST_NOTIFICATIONS` 하나뿐이에요(웹 푸시 알림을 앱 알림으로 받기 위해). 위치 권한은 없어요 — 위치는 크롬이 직접 물어봐요. |
| 버전 | `version.properties` (처음은 versionCode 1, versionName 1.0.0) |

## 주말에 할 일 (순서대로)

저장소 폴더(`~/atman`)에서 실행해요. JDK 17·안드로이드 SDK 는 이 Mac 에 이미 있어요.

1. **업로드 키 만들기 (딱 한 번)**
   ```bash
   scripts/android/make-upload-key.sh
   ```
   `~/itdot-keys/itdot-upload.jks` 가 생겨요. keytool 이 비밀번호를 세 번 물어요(만들기 2번, 지문 확인 1번).
   끝에 나오는 **업로드 키 SHA-256** 을 적어 두고, **키 파일과 비밀번호를 서로 다른 두 곳에 따로 백업**하세요.

2. **AAB 만들기**
   ```bash
   scripts/android/build-aab.sh          # 폰에 직접 깔아 보려면 --apk 를 붙여요
   ```
   비밀번호를 한 번 물어보고 `apps/worker-android/dist/itdot-worker-1.0.0-1.aab` 를 만들어요.
   서명·패키지 이름·버전·targetSdk 36 을 스스로 확인하고, 하나라도 틀리면 멈춰요.

3. **Play Console 에 올리기**
   앱 만들기 → **내부 테스트** 트랙 → 새 버전 → 위 AAB 업로드.
   'Play 앱 서명'은 기본값(Google 이 앱 서명 키를 만들어 관리)을 그대로 쓰면 돼요.

4. **assetlinks.json 만들기** — 이걸 해야 앱에서 주소창이 사라져요
   Play Console → **앱 무결성 → Play 앱 서명**(메뉴 이름은 조금 다를 수 있어요)에서
   **'앱 서명 키 인증서'의 SHA-256** 을 복사해요. 1번의 업로드 키 지문과 다른 값이에요.
   ```bash
   node scripts/android/assetlinks.mjs <앱 서명 키 SHA-256> <업로드 키 SHA-256>
   ```
   `apps/worker-web/public/.well-known/assetlinks.json` 이 생겨요. 이 파일을 커밋하고 worker-web 을 평소처럼 배포해요.

5. **확인**
   - `https://itdot.co.kr/.well-known/assetlinks.json` 이 열리는지
   - [Google 확인 도구](https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://itdot.co.kr&relation=delegate_permission/common.handle_all_urls) 에 `kr.co.itdot.worker` 가 나오는지
   - 내부 테스트로 설치한 앱을 열었을 때 위쪽에 주소창이 없는지

## 버전 올리기

`version.properties` 의 `versionCode` 를 1 올리고 `versionName` 을 바꾼 뒤 `scripts/android/build-aab.sh` 를 다시 실행해요.
한 번 올린 versionCode 는 다시 못 써요. 이번 한 번만 다르게 빌드하려면 환경 변수를 써요.
```bash
ITDOT_VERSION_CODE=2 ITDOT_VERSION_NAME=1.0.1 scripts/android/build-aab.sh
```

## 앱 설정 바꾸기 (이름·색·아이콘·바로가기)

1. `twa-manifest.json` 을 고쳐요. (JSON 이라 주석을 못 달아서 설명은 이 문서에 둬요.)
2. `scripts/android/bubblewrap-update.sh` 를 실행해요. Bubblewrap 1.27.0 으로 프로젝트를 다시 만들고,
   잇닿용 수정 세 가지(버전 읽기, jcenter → mavenCentral, AndroidManifest 의 package 속성 삭제)를 다시 넣어요.
   아이콘은 itdot.co.kr 에서 새로 받아요.
3. `git diff -- apps/worker-android` 로 바뀐 점을 보고, 버전을 올려 다시 빌드해요.

`app/` 아래 파일은 모두 생성된 파일이라 손으로 고치면 다음 생성 때 사라져요.
`bubblewrap build` 는 쓰지 않아요(서명·확인은 `build-aab.sh` 가 해요).
`app/src/main/res/xml/shortcuts.xml` 은 Gradle 이 실행될 때마다 `app/build.gradle` 의 바로가기 목록으로 다시 채워요.

## 알아 둘 점

- **주소창**: assetlinks.json 이 배포되기 전이나, 업로드 키로 서명한 APK 를 직접 깔았는데 그 지문이 파일에 없으면
  위쪽에 주소창이 보여요. 앱이 고장 난 게 아니에요. 카카오 로그인처럼 다른 도메인으로 잠깐 나갈 때도 주소창이 보이는 게 정상이에요.
- **브라우저**: TWA 는 크롬(또는 TWA 를 지원하는 브라우저)이 있어야 전체 화면으로 열려요. 없으면 주소창이 있는 Custom Tab 으로 열려요.
- **알림 아이콘**: 지금 아이콘(파란 사각형)을 그대로 쓰면 상태 표시줄 알림 아이콘이 흰 사각형으로 보여요.
  흰 글자만 있고 배경이 투명한 PNG 를 worker-web 에 올린 뒤 `twa-manifest.json` 에 `"monochromeIconUrl"` 로 넣고 다시 생성하면 고쳐져요.
- **업로드 키**: 저장소 밖(`~/itdot-keys/`)에만 둬요. `.jks`·`.keystore` 는 이 폴더 `.gitignore` 에도 막혀 있어요.
