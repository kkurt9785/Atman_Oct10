#!/usr/bin/env bash
# 잇닿 근무자 앱(TWA)의 안드로이드 프로젝트를 twa-manifest.json 에서 다시 만들어요.
#
# 사용법: scripts/android/bubblewrap-update.sh
#
# 언제 쓰나요: apps/worker-android/twa-manifest.json(이름·색·아이콘·바로가기 등)을 바꿨을 때만 써요.
#             버전만 올릴 때는 필요 없어요(version.properties 만 바꾸면 돼요).
#
# 하는 일
#   1. Bubblewrap CLI(아래 버전으로 고정)로 Gradle 프로젝트를 새로 만들어요.
#      app/, gradle/, build.gradle, settings.gradle, gradle.properties, gradlew, store_icon.png 는
#      지우고 다시 만들어요. twa-manifest.json, version.properties, README.md, .gitignore, dist/ 는 그대로 둬요.
#      아이콘은 twa-manifest.json 에 적힌 주소(itdot.co.kr)에서 새로 받아요.
#   2. 잇닿용 수정 세 가지를 다시 넣고, 잘 들어갔는지 확인해요.
#      - app/build.gradle: 버전을 version.properties(또는 환경 변수)에서 읽게 해요.
#      - build.gradle: 문 닫은 jcenter() 저장소를 mavenCentral() 로 바꿔요.
#      - app/src/main/AndroidManifest.xml: AGP 8 이 무시하고 경고만 내는 package="..." 속성을 지워요.
#        (패키지 이름은 app/build.gradle 의 namespace·applicationId 로 정해져요.)
set -euo pipefail

BUBBLEWRAP_VERSION="1.27.0"

die() { printf '\n[오류] %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
project_dir="$repo_root/apps/worker-android"
manifest="$project_dir/twa-manifest.json"

[ -f "$manifest" ] || die "twa-manifest.json 이 없어요: $manifest"
command -v node >/dev/null 2>&1 || die "Node.js 가 필요해요. (node 명령을 찾지 못했어요)"
command -v npx >/dev/null 2>&1 || die "npx 가 필요해요. (Node.js 와 함께 설치돼요)"

# Bubblewrap 은 설정 파일에 JDK·SDK 위치가 없으면 직접 내려받으려고 물어봐요.
# 여기서는 임시 설정 파일을 만들어 넘기므로 ~/.bubblewrap 이 없어도 돼요.
if [ -z "${JAVA_HOME:-}" ]; then
  if [ -x /usr/libexec/java_home ]; then
    JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)" || die "JDK 17 을 찾지 못했어요. JAVA_HOME 을 지정해 주세요."
  else
    die "JAVA_HOME 을 지정해 주세요. (JDK 17)"
  fi
fi
android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
[ -d "$android_home/platforms" ] || die "안드로이드 SDK 를 찾지 못했어요: $android_home (ANDROID_HOME 을 지정해 주세요)"

# Bubblewrap 은 macOS 에서 jdkPath 뒤에 /Contents/Home 을 붙여 써요.
jdk_path="${JAVA_HOME%/}"
case "$(uname -s)" in
  Darwin) jdk_path="${jdk_path%/Contents/Home}" ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
JDK_PATH="$jdk_path" SDK_PATH="$android_home" node -e '
  require("fs").writeFileSync(process.argv[1], JSON.stringify({
    jdkPath: process.env.JDK_PATH, androidSdkPath: process.env.SDK_PATH }));
' "$tmp_dir/bubblewrap-config.json"

info "Bubblewrap ${BUBBLEWRAP_VERSION} 로 프로젝트를 다시 만들어요: $project_dir"
info "(app/ 아래를 손으로 고친 게 있다면 사라져요. 고칠 게 있으면 twa-manifest.json 이나 이 스크립트에 넣어 주세요.)"
(
  cd "$project_dir"
  npx --yes "@bubblewrap/cli@${BUBBLEWRAP_VERSION}" update \
    --skipVersionUpgrade \
    --manifest="$manifest" \
    --directory="$project_dir" \
    --config="$tmp_dir/bubblewrap-config.json"
)

app_gradle="$project_dir/app/build.gradle"
root_gradle="$project_dir/build.gradle"
android_manifest="$project_dir/app/src/main/AndroidManifest.xml"
[ -f "$app_gradle" ] && [ -f "$root_gradle" ] && [ -f "$android_manifest" ] \
  || die "Bubblewrap 이 프로젝트 파일을 다 만들지 못했어요."

# app/build.gradle 에 넣을 버전 블록 (Groovy). 따옴표 heredoc 이라 셸이 아무것도 바꾸지 않아요.
version_block="$(cat <<'GRADLE'
// ── 잇닿: 버전 ──────────────────────────────────────────────────────────────
// scripts/android/bubblewrap-update.sh 가 넣은 부분이에요. 프로젝트를 다시 만들면 다시 넣어요.
// 버전은 apps/worker-android/version.properties 에서 읽어요.
// ITDOT_VERSION_CODE / ITDOT_VERSION_NAME 환경 변수가 있으면 그 값이 우선이에요.
def itdotVersionFile = rootProject.file('version.properties')
def itdotVersionProps = new Properties()
if (itdotVersionFile.isFile()) {
    itdotVersionFile.withInputStream { itdotVersionProps.load(it) }
}
def itdotVersionCodeText = (System.getenv('ITDOT_VERSION_CODE') ?: itdotVersionProps.getProperty('versionCode', '')).trim()
def itdotVersionName = (System.getenv('ITDOT_VERSION_NAME') ?: itdotVersionProps.getProperty('versionName', '')).trim()
if (!(itdotVersionCodeText ==~ /[1-9][0-9]{0,9}/) || itdotVersionCodeText.toLong() > 2100000000L) {
    throw new GradleException("versionCode 가 올바르지 않아요: '${itdotVersionCodeText}'. ${itdotVersionFile} 의 versionCode 를 1 ~ 2100000000 사이 정수로 적어 주세요.")
}
if (!(itdotVersionName ==~ /[0-9]+(\.[0-9]+){0,3}([-+][0-9A-Za-z.]+)?/)) {
    throw new GradleException("versionName 이 올바르지 않아요: '${itdotVersionName}'. ${itdotVersionFile} 의 versionName 을 1.0.0 같은 형식으로 적어 주세요.")
}
def itdotVersionCode = itdotVersionCodeText.toInteger()
// ────────────────────────────────────────────────────────────────────────────

GRADLE
)"

ITDOT_GRADLE_BLOCK="$version_block" node - "$app_gradle" "$root_gradle" "$android_manifest" <<'NODE'
const fs = require('fs');
const [appGradle, rootGradle, androidManifest] = process.argv.slice(2);
const block = process.env.ITDOT_GRADLE_BLOCK + '\n\n';

function replaceExactlyOnce(text, pattern, replacement, label) {
  const hits = text.match(new RegExp(pattern.source, pattern.flags + 'g')) || [];
  if (hits.length !== 1) {
    throw new Error(`${label}: 바꿀 곳이 ${hits.length}군데예요. 1군데여야 해요. Bubblewrap 템플릿이 바뀌었는지 확인해 주세요.`);
  }
  return text.replace(pattern, replacement);
}

let app = fs.readFileSync(appGradle, 'utf8');
if (app.includes('잇닿: 버전')) throw new Error('app/build.gradle 에 버전 블록이 이미 있어요.');
app = replaceExactlyOnce(app, /^(\s*)versionCode\s+\S+\s*$/m, '$1versionCode itdotVersionCode', 'versionCode');
app = replaceExactlyOnce(app, /^(\s*)versionName\s+.*$/m, '$1versionName itdotVersionName', 'versionName');
app = replaceExactlyOnce(app, /^android \{$/m, block + 'android {', 'android 블록');
fs.writeFileSync(appGradle, app);

let root = fs.readFileSync(rootGradle, 'utf8');
const jcenter = (root.match(/jcenter\(\)/g) || []).length;
if (jcenter === 0) throw new Error('build.gradle 에 jcenter() 가 없어요. Bubblewrap 템플릿이 바뀌었는지 확인해 주세요.');
root = root.replace(/jcenter\(\)/g, 'mavenCentral()');
fs.writeFileSync(rootGradle, root);

let manifestXml = fs.readFileSync(androidManifest, 'utf8');
manifestXml = replaceExactlyOnce(manifestXml, /(<manifest\b[^>]*?)\s+package="[^"]*"/, '$1', 'AndroidManifest package 속성');
fs.writeFileSync(androidManifest, manifestXml);

console.log(`잇닿 수정 적용: app/build.gradle 버전 블록, build.gradle jcenter() → mavenCentral() ${jcenter}곳, AndroidManifest package 속성 삭제`);
NODE

# 수정이 정확히 들어갔는지 다시 확인해요.
grep -Eq '^[[:space:]]+versionCode itdotVersionCode$' "$app_gradle" || die "app/build.gradle 의 versionCode 수정이 빠졌어요."
grep -Eq '^[[:space:]]+versionName itdotVersionName$' "$app_gradle" || die "app/build.gradle 의 versionName 수정이 빠졌어요."
if grep -q 'jcenter()' "$root_gradle"; then die "build.gradle 에 jcenter() 가 남아 있어요."; fi
if grep -Eq '(^|[[:space:]])package="' "$android_manifest"; then die "AndroidManifest.xml 에 package 속성이 남아 있어요."; fi

info ""
info "다 됐어요. 바뀐 점은 git diff -- apps/worker-android 로 확인하세요."
info "Play 에 다시 올릴 거라면 version.properties 의 versionCode 를 올린 뒤 scripts/android/build-aab.sh 를 실행하세요."
