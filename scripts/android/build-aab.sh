#!/usr/bin/env bash
# 잇닿 근무자 앱(TWA) — Google Play 에 올릴 서명된 AAB 를 만들어요.
#
# 사용법: scripts/android/build-aab.sh [--apk]
#   --apk   폰·에뮬레이터에 바로 설치해 볼 수 있는 서명된 범용(universal) APK 도 같이 만들어요.
#
# 결과물: apps/worker-android/dist/itdot-worker-<versionName>-<versionCode>.aab (--apk 면 .apk 도)
#
# 환경 변수 (모두 선택)
#   ITDOT_UPLOAD_KEYSTORE        업로드 키 파일 (기본: ~/itdot-keys/itdot-upload.jks)
#   ITDOT_UPLOAD_KEY_ALIAS       키 별칭 (기본: upload)
#   ITDOT_UPLOAD_STORE_PASSWORD  키 저장소 비밀번호. 없으면 화면에 안 보이게 물어봐요.
#   ITDOT_UPLOAD_KEY_PASSWORD    키 비밀번호. 없으면 저장소 비밀번호를 써요(PKCS12 키는 둘이 같아요).
#   ITDOT_VERSION_CODE / ITDOT_VERSION_NAME  version.properties 대신 이번에만 쓸 버전
#   JAVA_HOME (JDK 17), ANDROID_HOME (안드로이드 SDK)
#
# 비밀번호는 명령줄 인자로 넘기지 않아요. 서명 도구(jarsigner·apksigner·keytool)에만 환경 변수로 넘기고,
# Gradle 에는 넘기지 않아요.
set -euo pipefail

REQUIRED_TARGET_SDK=36

die() { printf '\n[오류] %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
step() { printf '\n▶ %s\n' "$*"; }

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

want_apk=0
for arg in "$@"; do
  case "$arg" in
    --apk) want_apk=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "알 수 없는 옵션이에요: $arg (사용법: scripts/android/build-aab.sh [--apk])" ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
project_dir="$repo_root/apps/worker-android"
dist_dir="$project_dir/dist"
twa_manifest="$project_dir/twa-manifest.json"
version_file="$project_dir/version.properties"

# ── 도구 찾기 ────────────────────────────────────────────────────────────────
if [ -z "${JAVA_HOME:-}" ]; then
  if [ -x /usr/libexec/java_home ]; then
    JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)" || die "JDK 17 을 찾지 못했어요. JAVA_HOME 을 지정해 주세요."
  else
    die "JAVA_HOME 을 지정해 주세요. (JDK 17)"
  fi
fi
export JAVA_HOME
keytool="$JAVA_HOME/bin/keytool"
jarsigner="$JAVA_HOME/bin/jarsigner"
[ -x "$keytool" ] && [ -x "$jarsigner" ] || die "JAVA_HOME 에 keytool·jarsigner 가 없어요: $JAVA_HOME"
java_major="$("$JAVA_HOME/bin/java" -XshowSettings:properties -version 2>&1 | sed -nE 's/^[[:space:]]*java\.specification\.version = ([0-9]+).*/\1/p')"
[ -n "$java_major" ] && [ "$java_major" -ge 17 ] || die "JDK 17 이상이 필요해요. 지금: ${java_major:-알 수 없음} ($JAVA_HOME)"

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
export ANDROID_HOME
[ -d "$ANDROID_HOME/platforms/android-$REQUIRED_TARGET_SDK" ] \
  || die "안드로이드 SDK 플랫폼 $REQUIRED_TARGET_SDK 이 없어요: $ANDROID_HOME/platforms/android-$REQUIRED_TARGET_SDK"

build_tools=""
for dir in $(ls -1 "$ANDROID_HOME/build-tools" 2>/dev/null | sort -V -r); do
  candidate="$ANDROID_HOME/build-tools/$dir"
  if [ -x "$candidate/aapt2" ] && [ -x "$candidate/apksigner" ] && [ -x "$candidate/zipalign" ]; then
    build_tools="$candidate"
    break
  fi
done
[ -n "$build_tools" ] || die "aapt2·apksigner·zipalign 이 있는 build-tools 를 찾지 못했어요: $ANDROID_HOME/build-tools"
aapt2="$build_tools/aapt2"
apksigner="$build_tools/apksigner"
zipalign="$build_tools/zipalign"
command -v unzip >/dev/null 2>&1 && command -v zip >/dev/null 2>&1 || die "zip·unzip 명령이 필요해요."

# ── 기대값: 패키지 이름(twa-manifest.json)과 버전(version.properties 또는 환경 변수) ──
[ -f "$twa_manifest" ] || die "twa-manifest.json 이 없어요: $twa_manifest"
package_id="$(sed -nE 's/^[[:space:]]*"packageId"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$twa_manifest")"
[ -n "$package_id" ] && [ "$(printf '%s\n' "$package_id" | wc -l | tr -d ' ')" = "1" ] \
  || die "twa-manifest.json 에서 packageId 를 읽지 못했어요."

prop_value() {
  [ -f "$version_file" ] || return 0
  sed -nE "s/^[[:space:]]*$1[[:space:]]*[=:][[:space:]]*([^[:space:]]+)[[:space:]]*$/\1/p" "$version_file" | tail -n 1
}
version_code="${ITDOT_VERSION_CODE:-$(prop_value versionCode)}"
version_name="${ITDOT_VERSION_NAME:-$(prop_value versionName)}"
[[ "$version_code" =~ ^[1-9][0-9]{0,9}$ ]] && [ "$version_code" -le 2100000000 ] \
  || die "versionCode 가 올바르지 않아요: '${version_code}'. $version_file 을 확인하세요. (1 ~ 2100000000)"
[[ "$version_name" =~ ^[0-9]+(\.[0-9]+){0,3}([-+][0-9A-Za-z.]+)?$ ]] \
  || die "versionName 이 올바르지 않아요: '${version_name}'. $version_file 을 확인하세요. (예: 1.0.0)"

# ── 업로드 키 ────────────────────────────────────────────────────────────────
keystore="${ITDOT_UPLOAD_KEYSTORE:-$HOME/itdot-keys/itdot-upload.jks}"
case "$keystore" in "~"/*) keystore="$HOME/${keystore#\~/}" ;; esac
key_alias="${ITDOT_UPLOAD_KEY_ALIAS:-upload}"
[ -f "$keystore" ] || die "업로드 키 파일이 없어요: $keystore
처음이라면 scripts/android/make-upload-key.sh 로 먼저 만들어 주세요."

if [ -z "${ITDOT_UPLOAD_STORE_PASSWORD+x}" ]; then
  [ -t 0 ] || die "비밀번호를 물어볼 터미널이 없어요. ITDOT_UPLOAD_STORE_PASSWORD 환경 변수로 넘겨 주세요."
  IFS= read -r -s -p "업로드 키 저장소 비밀번호 (화면에 안 보여요): " ITDOT_UPLOAD_STORE_PASSWORD
  printf '\n' >&2
fi
[ -n "$ITDOT_UPLOAD_STORE_PASSWORD" ] || die "비밀번호가 비어 있어요."
export ITDOT_UPLOAD_STORE_PASSWORD

kt() { "$keytool" -J-Duser.language=en -J-Duser.country=US "$@"; }

step "업로드 키 확인: $keystore (별칭 $key_alias)"
if ! store_list="$(kt -list -keystore "$keystore" -storepass:env ITDOT_UPLOAD_STORE_PASSWORD 2>&1)"; then
  case "$store_list" in
    *"password was incorrect"*|*"tampered"*) die "업로드 키 비밀번호가 맞지 않아요." ;;
    *) die "업로드 키를 열지 못했어요: $(printf '%s' "$store_list" | head -n 3)" ;;
  esac
fi
store_type="$(printf '%s\n' "$store_list" | sed -nE 's/^Keystore type: (.*)$/\1/p' | head -n 1)"
if ! key_info="$(kt -list -v -keystore "$keystore" -storepass:env ITDOT_UPLOAD_STORE_PASSWORD -alias "$key_alias" 2>&1)"; then
  die "키 저장소에 별칭 '$key_alias' 이 없어요. ITDOT_UPLOAD_KEY_ALIAS 를 확인하세요."
fi
upload_fp="$(printf '%s\n' "$key_info" | sed -nE 's/^[[:space:]]*SHA256:[[:space:]]*([0-9A-Fa-f:]+).*/\1/p' | head -n 1 | tr 'a-f' 'A-F')"
[ ${#upload_fp} -eq 95 ] || die "업로드 키의 SHA-256 지문을 읽지 못했어요."

if [ -z "${ITDOT_UPLOAD_KEY_PASSWORD+x}" ]; then
  ITDOT_UPLOAD_KEY_PASSWORD="$ITDOT_UPLOAD_STORE_PASSWORD"
  if { [ "$store_type" = "JKS" ] || [ "$store_type" = "JCEKS" ]; } && [ -t 0 ]; then
    IFS= read -r -s -p "키 비밀번호 (저장소 비밀번호와 같으면 그냥 Enter): " key_pw_input
    printf '\n' >&2
    if [ -n "$key_pw_input" ]; then ITDOT_UPLOAD_KEY_PASSWORD="$key_pw_input"; fi
    unset key_pw_input
  fi
fi
export ITDOT_UPLOAD_KEY_PASSWORD
info "  형식 ${store_type:-?}, SHA-256 $upload_fp"

# ── 빌드 (Gradle 에는 비밀번호를 넘기지 않아요) ──────────────────────────────
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

step "Gradle 빌드: $package_id $version_name ($version_code)"
gradle_tasks=(clean bundleRelease)
if [ "$want_apk" -eq 1 ]; then gradle_tasks+=(packageReleaseUniversalApk); fi
env -u ITDOT_UPLOAD_STORE_PASSWORD -u ITDOT_UPLOAD_KEY_PASSWORD \
  ITDOT_VERSION_CODE="$version_code" ITDOT_VERSION_NAME="$version_name" \
  "$project_dir/gradlew" -p "$project_dir" --console=plain --warning-mode=summary "${gradle_tasks[@]}"

unsigned_aab="$project_dir/app/build/outputs/bundle/release/app-release.aab"
unsigned_apk="$project_dir/app/build/outputs/apk_from_bundle/release/app-release-universal-unsigned.apk"
[ -s "$unsigned_aab" ] || die "Gradle 이 AAB 를 만들지 못했어요: $unsigned_aab"

# ── 확인 도우미 ──────────────────────────────────────────────────────────────
normalize_fp() {  # 아무 형식의 SHA-256 → AB:CD:... (대문자, 콜론)
  local hex
  hex="$(printf '%s' "$1" | tr -d ': \t' | tr 'a-f' 'A-F')"
  [[ "$hex" =~ ^[0-9A-F]{64}$ ]] || return 1
  printf '%s' "$hex" | sed -E 's/(..)/\1:/g; s/:$//'
}

# aapt2 로 manifest 를 읽고 패키지·버전·SDK 를 확인해요. 결과는 전역 변수에 담아요.
check_badging() {  # $1=이름, $2=APK(또는 proto APK) 경로
  local label="$1" file="$2" badging pkg_line
  badging="$("$aapt2" dump badging "$file" 2>&1)" || die "$label: aapt2 로 읽지 못했어요: $(printf '%s' "$badging" | head -n 2)"
  pkg_line="$(printf '%s\n' "$badging" | sed -n '/^package:/{p;q;}')"
  got_pkg="$(printf '%s' "$pkg_line" | sed -nE "s/^package: name='([^']*)'.*/\1/p")"
  got_vcode="$(printf '%s' "$pkg_line" | sed -nE "s/.* versionCode='([^']*)'.*/\1/p")"
  got_vname="$(printf '%s' "$pkg_line" | sed -nE "s/.* versionName='([^']*)'.*/\1/p")"
  got_min="$(printf '%s\n' "$badging" | sed -nE "s/^(minSdkVersion|sdkVersion):'([0-9]+)'.*/\2/p" | head -n 1)"
  got_target="$(printf '%s\n' "$badging" | sed -nE "s/^targetSdkVersion:'([0-9]+)'.*/\1/p" | head -n 1)"
  got_perms="$("$aapt2" dump permissions "$file" 2>/dev/null | sed -nE "s/^uses-permission: name='([^']+)'.*/\1/p")"
  [ "$got_pkg" = "$package_id" ] || die "$label: 패키지 이름이 '$got_pkg' 예요. twa-manifest.json 은 '$package_id' 예요. bubblewrap-update.sh 로 다시 만들어 주세요."
  [ "$got_vcode" = "$version_code" ] || die "$label: versionCode 가 '$got_vcode' 예요. (기대 $version_code)"
  [ "$got_vname" = "$version_name" ] || die "$label: versionName 이 '$got_vname' 이에요. (기대 $version_name)"
  [ "$got_target" = "$REQUIRED_TARGET_SDK" ] || die "$label: targetSdk 가 '$got_target' 예요. Play 신규 앱은 $REQUIRED_TARGET_SDK 이어야 해요."
  [ -n "$got_min" ] || die "$label: minSdk 를 읽지 못했어요."
}

file_size() {
  local bytes
  bytes="$(wc -c < "$1" | tr -d ' ')"
  awk -v b="$bytes" 'BEGIN { if (b >= 1048576) printf "%.2f MB (%d bytes)", b/1048576, b; else printf "%.1f KB (%d bytes)", b/1024, b }'
}

# ── AAB 서명·확인 ────────────────────────────────────────────────────────────
step "AAB 서명 (jarsigner)"
signed_aab="$work_dir/signed.aab"
if ! sign_log="$("$jarsigner" -J-Duser.language=en -keystore "$keystore" \
      -storepass:env ITDOT_UPLOAD_STORE_PASSWORD -keypass:env ITDOT_UPLOAD_KEY_PASSWORD \
      -signedjar "$signed_aab" "$unsigned_aab" "$key_alias" 2>&1)"; then
  die "AAB 서명에 실패했어요: $(printf '%s' "$sign_log" | head -n 3)"
fi

verify_log="$("$jarsigner" -J-Duser.language=en -verify "$signed_aab" 2>&1)" || die "AAB 서명 확인에 실패했어요: $verify_log"
printf '%s' "$verify_log" | grep -q '^jar verified\.' || die "AAB 서명 확인에 실패했어요: $verify_log"
if printf '%s' "$verify_log" | grep -qi 'unsigned entries'; then die "AAB 에 서명 안 된 항목이 있어요."; fi
aab_signers="$(kt -printcert -jarfile "$signed_aab" | sed -nE 's/^[[:space:]]*SHA256:[[:space:]]*([0-9A-Fa-f:]+).*/\1/p' | tr 'a-f' 'A-F' | sort -u)"
[ "$aab_signers" = "$upload_fp" ] || die "AAB 서명 인증서가 업로드 키와 달라요: $aab_signers"
info "  jarsigner -verify: jar verified / 서명 인증서 = 업로드 키"

step "AAB 안의 manifest 확인 (aapt2)"
# aapt2 는 .aab 를 직접 못 읽어서, base 모듈을 aapt2 가 읽는 proto APK 모양으로 다시 묶어 읽어요.
proto_dir="$work_dir/aab-base"
mkdir -p "$proto_dir"
unzip -q "$signed_aab" 'base/manifest/AndroidManifest.xml' 'base/resources.pb' 'base/res/*' -d "$proto_dir"
mv "$proto_dir/base/manifest/AndroidManifest.xml" "$proto_dir/base/AndroidManifest.xml"
(cd "$proto_dir/base" && zip -q -r -X "$work_dir/aab-base-proto.apk" AndroidManifest.xml resources.pb res)
check_badging "AAB" "$work_dir/aab-base-proto.apk"
aab_min="$got_min"; aab_target="$got_target"; aab_perms="$got_perms"

mkdir -p "$dist_dir"
base_name="itdot-worker-${version_name}-${version_code}"
out_aab="$dist_dir/$base_name.aab"
if [ -e "$out_aab" ]; then info "  (같은 이름의 이전 파일을 새 파일로 바꿔요: $out_aab)"; fi
mv -f "$signed_aab" "$out_aab"

# ── (선택) 범용 APK ──────────────────────────────────────────────────────────
out_apk=""
if [ "$want_apk" -eq 1 ]; then
  step "범용 APK 서명 (apksigner, 같은 AAB 에서 만든 APK)"
  [ -s "$unsigned_apk" ] || die "Gradle 이 범용 APK 를 만들지 못했어요: $unsigned_apk"
  aligned_apk="$work_dir/aligned.apk"
  signed_apk="$work_dir/signed.apk"
  "$zipalign" -f -p 4 "$unsigned_apk" "$aligned_apk"
  if ! apk_sign_log="$("$apksigner" sign --ks "$keystore" --ks-key-alias "$key_alias" \
        --ks-pass env:ITDOT_UPLOAD_STORE_PASSWORD --key-pass env:ITDOT_UPLOAD_KEY_PASSWORD \
        --v4-signing-enabled false --out "$signed_apk" "$aligned_apk" 2>&1)"; then
    die "APK 서명에 실패했어요: $(printf '%s' "$apk_sign_log" | head -n 3)"
  fi
  apk_verify="$("$apksigner" verify --print-certs -v "$signed_apk" 2>&1)" || die "APK 서명 확인에 실패했어요: $apk_verify"
  printf '%s\n' "$apk_verify" | grep -q '^Number of signers: 1$' || die "APK 서명자가 1명이 아니에요."
  # build-tools 버전마다 표기가 달라요: "Signer #1 certificate SHA-256 digest:" / "V3.0 Signer: certificate SHA-256 digest:"
  apk_fp_raw="$(printf '%s\n' "$apk_verify" | sed -nE 's/.*[Ss]igner.*certificate SHA-256 digest: ([0-9a-fA-F]{64})$/\1/p' | tr 'A-F' 'a-f' | sort -u)"
  [ "$(printf '%s\n' "$apk_fp_raw" | grep -c .)" = "1" ] || die "APK 서명 인증서가 하나가 아니거나 읽지 못했어요."
  apk_fp="$(normalize_fp "$apk_fp_raw")" || die "APK 서명 인증서 지문을 읽지 못했어요."
  [ "$apk_fp" = "$upload_fp" ] || die "APK 서명 인증서가 업로드 키와 달라요: $apk_fp"
  apk_schemes="$(printf '%s\n' "$apk_verify" | sed -nE 's/^Verified using (v[0-9.]+) scheme .*: true$/\1/p' | tr '\n' ' ')"
  check_badging "APK" "$signed_apk"
  out_apk="$dist_dir/$base_name.apk"
  mv -f "$signed_apk" "$out_apk"
  info "  apksigner verify: 통과 (${apk_schemes% }) / 서명 인증서 = 업로드 키"
fi

# ── 요약 ─────────────────────────────────────────────────────────────────────
step "완료"
info "  AAB: $out_aab"
info "       $(file_size "$out_aab")"
if [ -n "$out_apk" ]; then
  info "  APK: $out_apk"
  info "       $(file_size "$out_apk")"
fi
info "  패키지 $package_id · 버전 $version_name ($version_code) · minSdk $aab_min · targetSdk $aab_target"
info "  권한:"
printf '%s\n' "$aab_perms" | sed 's/^/    - /'
info "  업로드 키 SHA-256: $upload_fp"
info ""
info "다음 단계"
info "  1. Play Console 에서 이 AAB 를 (내부 테스트 트랙부터) 올려요."
info "  2. 처음 올렸다면 Play Console '앱 무결성 → Play 앱 서명' 에서 '앱 서명 키 인증서'의 SHA-256 을 복사해"
info "     node scripts/android/assetlinks.mjs <앱 서명 키 SHA-256> $upload_fp"
info "     로 assetlinks.json 을 만들고 worker-web 을 배포해요."
if [ -n "$out_apk" ]; then
  info "  (APK 설치 테스트: adb install -r \"$out_apk\")"
fi
