#!/usr/bin/env bash
# 잇닿 근무자 앱 — Google Play 업로드 키를 처음 한 번만 만들어요.
#
# 사용법: scripts/android/make-upload-key.sh
#
#   기본 위치: ~/itdot-keys/itdot-upload.jks (별칭 upload, RSA 2048, 10000일, PKCS12 형식)
#   다른 곳에 만들려면: ITDOT_UPLOAD_KEYSTORE=/경로/파일.jks scripts/android/make-upload-key.sh
#   별칭을 바꾸려면:   ITDOT_UPLOAD_KEY_ALIAS=이름 (build-aab.sh 에도 같은 값을 줘야 해요)
#
# 비밀번호는 keytool 이 직접 물어봐요. 입력한 글자는 화면에 보이지 않고,
# 이 스크립트는 비밀번호를 인자로 받거나 출력하거나 저장하지 않아요.
# 이미 파일이 있으면 절대 덮어쓰지 않아요.
set -euo pipefail

die() { printf '\n[오류] %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd -P)"

keystore="${ITDOT_UPLOAD_KEYSTORE:-$HOME/itdot-keys/itdot-upload.jks}"
alias_name="${ITDOT_UPLOAD_KEY_ALIAS:-upload}"
dname="CN=잇닿 근무자, O=케셰르, C=KR"

# keytool 은 입력과 출력이 모두 터미널일 때만 비밀번호를 화면에 안 보이게 받아요.
[ -t 0 ] && [ -t 1 ] || die "터미널에서 직접 실행해 주세요. (파이프나 리디렉션 없이 실행해야 비밀번호가 화면에 안 보여요)"
[[ "$alias_name" =~ ^[A-Za-z0-9._-]+$ ]] || die "별칭은 영문·숫자·. _ - 만 쓸 수 있어요: $alias_name"

# keytool 찾기 (JDK 17)
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then
  keytool="$JAVA_HOME/bin/keytool"
elif [ -x /usr/libexec/java_home ] && java_home="$(/usr/libexec/java_home -v 17 2>/dev/null)"; then
  keytool="$java_home/bin/keytool"
elif command -v keytool >/dev/null 2>&1; then
  keytool="$(command -v keytool)"
else
  die "keytool 을 찾지 못했어요. JDK 17 을 설치하거나 JAVA_HOME 을 지정해 주세요."
fi

# 경로 정리: ~ 풀기, 상대 경로는 절대 경로로
case "$keystore" in
  "~"/*) keystore="$HOME/${keystore#\~/}" ;;
esac
case "$keystore" in
  /*) ;;
  *) keystore="$PWD/$keystore" ;;
esac
case "$keystore" in
  */../*|*/./*|*/..|*/.) die "경로에 . 이나 .. 를 쓰지 말고 바로 적어 주세요: $keystore" ;;
esac

if [ -e "$keystore" ] || [ -L "$keystore" ]; then
  die "이미 파일이 있어요: $keystore
업로드 키는 한 번만 만들어요. 덮어쓰면 기존 키로 서명한 앱을 더 이상 업데이트할 수 없게 돼요.
새로 만들어야 한다면 다른 경로를 ITDOT_UPLOAD_KEYSTORE 로 지정하세요."
fi

# 저장소(레포) 안에는 만들지 않아요. 아직 없는 폴더는 가장 가까운 기존 상위 폴더로 판단해요.
keystore_dir="$(dirname "$keystore")"
existing="$keystore_dir"
while [ ! -d "$existing" ]; do existing="$(dirname "$existing")"; done
existing_real="$(cd "$existing" && pwd -P)"
case "$existing_real/" in
  "$repo_root"/*) die "키를 저장소 안에 만들 수 없어요: $keystore
저장소 밖(예: ~/itdot-keys/itdot-upload.jks)에 만들어 주세요." ;;
esac
if command -v git >/dev/null 2>&1 && git -C "$existing_real" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "이 위치는 git 저장소 안이에요: $existing_real
키 파일은 git 저장소 밖에 만들어 주세요."
fi

umask 077
mkdir -p "$keystore_dir"

info "Play 업로드 키를 만들어요."
info "  파일: $keystore"
info "  별칭: $alias_name / RSA 2048 / 10000일 / $dname"
info ""
info "keytool 이 비밀번호를 물어요. 입력한 글자는 화면에 보이지 않아요."
info "  '키 저장소 비밀번호 입력' (Enter keystore password) → 새 비밀번호(6자 이상)를 입력하세요."
info "  '새 비밀번호 다시 입력' (Re-enter new password)     → 같은 비밀번호를 한 번 더 입력하세요."
info ""

"$keytool" -genkeypair -v \
  -keystore "$keystore" -storetype PKCS12 \
  -alias "$alias_name" -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "$dname"

[ -f "$keystore" ] || die "키 파일이 만들어지지 않았어요."
chmod 600 "$keystore"

# 지문 보여 주기: 인증서(공개 정보)만 임시 파일로 꺼낸 뒤, 비밀번호 없이 지문을 읽어요.
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
cert_file="$tmp_dir/upload-cert.pem"

info ""
info "SHA-256 지문을 보여 드리려고 keytool 이 '키 저장소 비밀번호 입력'을 한 번 더 물어요. (방금 정한 비밀번호)"
# 주의: 이 keytool 의 출력은 터미널로 그대로 둬요. 출력을 돌리면 keytool 이 입력한 비밀번호를 화면에 보여 줘요.
exported=0
for attempt in 1 2 3; do
  if "$keytool" -exportcert -rfc -keystore "$keystore" -alias "$alias_name" -file "$cert_file"; then
    exported=1
    break
  fi
  if [ "$attempt" -lt 3 ]; then
    info "비밀번호가 맞지 않았어요. 다시 입력해 주세요. ($attempt/3)"
  fi
done

fingerprint=""
if [ "$exported" -eq 1 ]; then
  cert_info="$("$keytool" -J-Duser.language=en -J-Duser.country=US -printcert -file "$cert_file")"
  fingerprint="$(printf '%s\n' "$cert_info" | sed -nE 's/^[[:space:]]*SHA256:[[:space:]]*([0-9A-Fa-f:]+).*/\1/p')"
fi

info ""
info "업로드 키를 만들었어요: $keystore (별칭 $alias_name)"
if [ -n "$fingerprint" ]; then
  info ""
  info "업로드 키 SHA-256 인증서 지문:"
  info "  $fingerprint"
else
  info "지문은 나중에 이렇게 볼 수 있어요:"
  info "  \"$keytool\" -list -v -keystore \"$keystore\" -alias $alias_name"
fi
info ""
info "꼭 해 주세요"
info "  1. 키 파일(.jks)과 비밀번호를 서로 다른 두 곳에 따로 백업하세요."
info "     예) 키 파일은 iCloud Drive나 USB, 비밀번호는 비밀번호 관리자. 둘을 한곳에 같이 두지 마세요."
info "  2. 키 파일과 비밀번호를 git 에 올리거나 메신저·메일로 보내지 마세요."
info "  3. 잃어버리면 Play Console 에 '업로드 키 재설정'을 요청해야 하고, 며칠 걸려요."
info ""
info "참고: 위 지문은 '업로드 키' 지문이에요. Play 에서 받은 앱이 주소창 없이 열리려면"
info "      assetlinks.json 에 Play Console 의 '앱 서명 키' SHA-256 도 같이 넣어야 해요. (README 참고)"
info ""
info "다음 단계: scripts/android/build-aab.sh"
