"""데모 워커 auth 계정 5개 생성 — 워커 앱 풀사이클 시연용.

worker-web Splash의 데모 로그인 버튼(worker-demo-1~5)이 기대하는 계정을 만들고,
기존 데모 워커(is_demo) 행에 연결한다. QR·체크아웃 시연까지 가능하도록
활동지역 prefs와 정산 계좌(fail-closed 암호화 경유)까지 세팅한다.

또한 데모 병원은 지오펜스 필수 해제(원격 시연 대비 — 시연 기기에서 위치 거부 시 통과).
실행: python3 scripts/setup_demo_worker_accounts.py
"""
import json
import sys
import urllib.request
import urllib.error

ENV = "/Users/kihankim/atman/apps/worker-web/.env.local"
env = {}
for line in open(ENV):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        env[k] = v
ADMIN_ENV = "/Users/kihankim/atman/apps/admin-web/.env.local"
for line in open(ADMIN_ENV):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        env.setdefault(k, v)

BASE = (env.get("SUPABASE_URL") or env["NEXT_PUBLIC_SUPABASE_URL"]).rstrip("/")
SERVICE = env["SUPABASE_SERVICE_ROLE_KEY"]
ANON = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
PASSWORD = "Atman-demo-2026!"

# Splash.tsx의 DEMO_WORKERS와 일치해야 함. area_prefix로 기존 데모 워커 매칭.
ACCOUNTS = [
    ("worker-demo-1@demo.atman.co.kr", "gwangju_gwangsan", "rn", "광주 광산구", 35.1900, 126.8252),
    ("worker-demo-2@demo.atman.co.kr", "suwon_jangan",     "rn", "수원 장안구", 37.3037, 127.0106),
    ("worker-demo-3@demo.atman.co.kr", "suwon_gwonseon",   "na", "수원 권선구", 37.2574, 127.0286),
    ("worker-demo-4@demo.atman.co.kr", "suwon_paldal",     "rn", "수원 팔달구", 37.2636, 127.0305),
    ("worker-demo-5@demo.atman.co.kr", "suwon_yeongtong",  "na", "수원 영통구", 37.2905, 127.0574),
]


def req(method, path, body=None, key=SERVICE, bearer=None, prefer=None):
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {bearer or key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as res:
            raw = res.read()
            return res.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


for email, area, role, label, lat, lng in ACCOUNTS:
    # 1. auth 계정 생성 (존재 시 비번 리셋)
    status, body = req("POST", "/auth/v1/admin/users", {
        "email": email, "password": PASSWORD, "email_confirm": True,
        "user_metadata": {"profile_nickname": label + (" 간호사" if role == "rn" else " 간호조무사")},
    })
    if status in (200, 201):
        uid = body["id"]
    else:
        s2, users = req("GET", f"/auth/v1/admin/users?email={email}")
        found = next((u for u in (users or {}).get("users", []) if u["email"] == email), None)
        if not found:
            print(f"FAIL {email}: {status} {body}"); sys.exit(1)
        uid = found["id"]
        req("PUT", f"/auth/v1/admin/users/{uid}", {"password": PASSWORD, "email_confirm": True})

    # 2. profile: worker + 온보딩 완료
    req("POST", "/rest/v1/profiles?on_conflict=id",
        [{"id": uid, "role": "worker", "onboarding_done": True}],
        prefer="resolution=merge-duplicates")

    # 3. 해당 지역·직군의 기존 데모 워커 1명에 연결 (아직 미연결 행만)
    status, cands = req("GET",
        f"/rest/v1/workers?kakao_id=like.kakao_demo_{area}_*&role=eq.{role}&auth_user_id=is.null&select=id,kakao_id&order=kakao_id&limit=1")
    already = req("GET", f"/rest/v1/workers?auth_user_id=eq.{uid}&select=id")[1]
    if already:
        worker_id = already[0]["id"]
    elif cands:
        worker_id = cands[0]["id"]
        req("PATCH", f"/rest/v1/workers?id=eq.{worker_id}",
            {"auth_user_id": uid, "verification_status": "approved"})
    else:
        print(f"WARN {email}: 연결할 데모 워커 없음"); continue

    # 4. 활동지역 prefs (워커 홈 칩·매칭용)
    req("POST", "/rest/v1/worker_location_prefs?on_conflict=worker_id",
        [{"worker_id": uid, "locations": [{"label": label, "radius_km": 10, "lat": lat, "lng": lng}]}],
        prefer="resolution=merge-duplicates")

    # 5. 정산 계좌 — 사용자 JWT로 RPC 호출 (Vault 키 암호화 경유)
    status, sess = req("POST", "/auth/v1/token?grant_type=password",
                       {"email": email, "password": PASSWORD}, key=ANON, bearer=ANON)
    if status == 200 and sess.get("access_token"):
        s5, r5 = req("POST", "/rest/v1/rpc/upsert_my_bank_account", {
            "p_bank_code": "090", "p_bank_name": "카카오뱅크",
            "p_account_number": "33331299887766",
            "p_account_holder_name": label,
        }, key=ANON, bearer=sess["access_token"])
        bank = "계좌OK" if s5 in (200, 204) else f"계좌실패({r5})"
    else:
        bank = "로그인실패"
    print(f"{email} → worker {worker_id[:8]}… {bank}")

# 6. 데모 병원 지오펜스 필수 해제 (원격 시연: 위치 거부 시 통과)
status, _ = req("PATCH", "/rest/v1/facilities?is_demo=eq.true",
                {"attendance_geofence_required": False})
print(f"데모 병원 지오펜스 필수 해제: {status}")
print("완료 — 워커 앱 데모 로그인: worker-demo-1~5 / " + PASSWORD)
