"""데모 쇼케이스 되살리기 — seed_demo_showcase.sql 로직을 Admin API + PostgREST로 재현.

전제: 데모 병원 50개(is_demo)와 워커 95명은 DB에 이미 존재.
생성: 슈퍼계정 3개, facility_admin_access, 오늘(KST) 시프트 100개 + 지원/출근 기록.
"""
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

ENV = "/Users/kihankim/atman/apps/admin-web/.env.local"
env = {}
for line in open(ENV):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        env[k] = v

BASE = env["SUPABASE_URL"].rstrip("/")
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
HDR = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)
TODAY = NOW.date().isoformat()

def req(method, path, body=None, prefer=None):
    headers = dict(HDR)
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

# ── 1. 슈퍼계정 3개 (Admin API) ──────────────────────────────────────────────
ADMINS = [
    ("sales-demo-1@demo.atman.co.kr", "시연 슈퍼계정 1", "super"),
    ("sales-demo-2@demo.atman.co.kr", "시연 슈퍼계정 2", "sales"),
    ("sales-demo-3@demo.atman.co.kr", "시연 슈퍼계정 3", "operator"),
]
PASSWORD = "Atman-demo-2026!"
admin_ids = {}

for email, name, _ in ADMINS:
    status, body = req("POST", "/auth/v1/admin/users", {
        "email": email,
        "password": PASSWORD,
        "email_confirm": True,
        "user_metadata": {"profile_nickname": name},
    })
    if status in (200, 201):
        admin_ids[email] = body["id"]
    else:
        # 이미 존재 → 조회 후 비번 리셋
        s2, users = req("GET", f"/auth/v1/admin/users?email={email}")
        found = None
        if isinstance(users, dict):
            found = next((u for u in users.get("users", []) if u["email"] == email), None)
        if not found:
            print(f"FAIL create+lookup {email}: {status} {body}")
            sys.exit(1)
        admin_ids[email] = found["id"]
        req("PUT", f"/auth/v1/admin/users/{found['id']}", {"password": PASSWORD, "email_confirm": True})
print(f"1. 슈퍼계정: {len(admin_ids)}개 OK")

# ── 2. profiles (admin) ─────────────────────────────────────────────────────
rows = [{"id": uid, "role": "admin", "onboarding_done": True} for uid in admin_ids.values()]
status, body = req("POST", "/rest/v1/profiles?on_conflict=id", rows, prefer="resolution=merge-duplicates")
print(f"2. profiles: {status}")

# ── 3. facility_admin_access (3 계정 × 데모 병원 전체) ──────────────────────
status, facilities = req("GET", "/rest/v1/facilities?business_registration_number=like.DEMO-TARGET-*&select=id,business_registration_number,facility_type&order=business_registration_number")
assert status == 200, facilities
access_rows = []
for email, _, role in ADMINS:
    for f in facilities:
        access_rows.append({"user_id": admin_ids[email], "facility_id": f["id"], "access_role": role})
status, _ = req("POST", "/rest/v1/facility_admin_access?on_conflict=user_id,facility_id", access_rows, prefer="resolution=merge-duplicates")
print(f"3. facility_admin_access: {status} ({len(access_rows)} rows)")

# ── 4. 기존 데모 시프트 청소 (attendances → applications → shifts 순) ───────
status, old_shifts = req("GET", "/rest/v1/shifts?notes=like.DEMO-SHOWCASE-*&select=id")
old_ids = [s["id"] for s in (old_shifts or [])]
if old_ids:
    idlist = ",".join(f'"{i}"' for i in old_ids)
    req("DELETE", f"/rest/v1/shift_attendances?shift_id=in.({idlist})")
    req("DELETE", f"/rest/v1/shift_applications?shift_id=in.({idlist})")
    req("DELETE", f"/rest/v1/shifts?id=in.({idlist})")
print(f"4. 기존 데모 시프트 {len(old_ids)}개 삭제")

# ── 5. 워커 로드 (kakao_id 순 — seed의 rn 정렬 재현) ────────────────────────
status, workers = req("GET", "/rest/v1/workers?kakao_id=like.kakao_demo_*&select=id,kakao_id,role&order=kakao_id")
assert status == 200
print(f"5. 데모 워커: {len(workers)}명")

def worker_at(idx1):  # 1-based, 95명이라 100 인덱스는 모듈로로 순환
    return workers[(idx1 - 1) % len(workers)]

def times(rn, kind):
    m = rn % 3
    if kind == "matched":
        return {1: ("07:00", "15:00"), 2: ("15:00", "23:00"), 0: ("23:00", "07:00")}[m]
    return {1: ("15:00", "23:00"), 2: ("23:00", "07:00"), 0: ("07:00", "15:00")}[m]

iso = lambda dt: dt.astimezone(timezone.utc).isoformat()

# ── 6. 확정(in_progress) 시프트 50 + accepted 지원 + 출근 기록 ──────────────
matched_shifts = []
for rn, f in enumerate(facilities, start=1):
    w = worker_at(rn * 2 - 1)
    st, et = times(rn, "matched")
    wage = 17000 if w["role"] == "rn" else 14000
    dept = "일반병동" if f["facility_type"] in ("general_hospital", "small_hospital") else "요양병동"
    matched_shifts.append({
        "facility_id": f["id"], "required_role": w["role"], "shift_date": TODAY,
        "start_time": st, "end_time": et, "hourly_wage": wage,
        "estimated_total_pay": wage * 8,
        "description": "시연용 오늘 확정 근무입니다. 데모 워커가 배정되어 관리자 홈에 표시됩니다.",
        "department": dept, "notes": f"DEMO-SHOWCASE-MATCHED-{rn:04d}",
        "status": "in_progress", "matched_worker_id": w["id"],
        "matched_at": iso(NOW - timedelta(minutes=30)),
    })
status, created = req("POST", "/rest/v1/shifts", matched_shifts, prefer="return=representation")
assert status == 201, created
apps = [{
    "shift_id": s["id"], "worker_id": s["matched_worker_id"], "status": "accepted",
    "match_score": 95, "distance_meters": 900,
    "applied_at": iso(NOW - timedelta(hours=2)), "responded_at": iso(NOW - timedelta(minutes=45)),
} for s in created]
status, app_rows = req("POST", "/rest/v1/shift_applications", apps, prefer="return=representation")
assert status == 201, app_rows
att = [{
    "shift_id": a["shift_id"], "worker_id": a["worker_id"], "application_id": a["id"],
    "check_in_at": iso(NOW - timedelta(minutes=25)), "check_in_method": "qr", "check_in_distance_m": 80,
} for a in app_rows]
status, _ = req("POST", "/rest/v1/shift_attendances", att)
print(f"6. 확정 시프트 {len(created)} + 지원 {len(app_rows)} + 출근기록: {status}")

# ── 7. 모집(open) 시프트 50 + applied 지원 ──────────────────────────────────
open_shifts, open_workers = [], []
for rn, f in enumerate(facilities, start=1):
    w = worker_at(rn * 2)
    st, et = times(rn, "open")
    wage = 17500 if w["role"] == "rn" else 14500
    dept = "응급실" if f["facility_type"] in ("general_hospital", "small_hospital") else "요양병동"
    open_shifts.append({
        "facility_id": f["id"], "required_role": w["role"], "shift_date": TODAY,
        "start_time": st, "end_time": et, "hourly_wage": wage,
        "estimated_total_pay": wage * 8,
        "description": "시연용 오늘 모집 공고입니다. 데모 워커 지원자가 관리자 지원 현황에 표시됩니다.",
        "department": dept, "notes": f"DEMO-SHOWCASE-OPEN-{rn:04d}", "status": "open",
    })
    open_workers.append((rn, w))
status, created_open = req("POST", "/rest/v1/shifts", open_shifts, prefer="return=representation")
assert status == 201, created_open
by_notes = {s["notes"]: s for s in created_open}

# 지원자 3명/시프트 — 병원이 '여러 명 중 고르는' 시연 연출.
# 시프트 직군과 같은 직군 워커만, 시프트당 중복 없이 순환 배정.
by_role = {"rn": [w for w in workers if w["role"] == "rn"],
           "na": [w for w in workers if w["role"] == "na"]}
open_apps = []
for rn, w in open_workers:
    s = by_notes[f"DEMO-SHOWCASE-OPEN-{rn:04d}"]
    pool = by_role[w["role"]]
    picked = {pool[(rn * 3 + k * 7) % len(pool)]["id"] for k in range(5)}
    picked.discard(None)
    for j, wid in enumerate(sorted(picked)[:3]):
        open_apps.append({
            "shift_id": s["id"], "worker_id": wid, "status": "applied",
            "match_score": 72 + ((rn * 5 + j * 11) % 27),
            "distance_meters": 500 + ((rn * 53 + j * 431) % 7000),
            "applied_at": iso(NOW - timedelta(minutes=(rn * 3 + j * 17) % 170)),
        })
status, _ = req("POST", "/rest/v1/shift_applications", open_apps)
print(f"7. 모집 시프트 {len(created_open)} + 지원 {len(open_apps)}: {status}")

# ── 8. 병원 근태관리 데모 직원·휴가·오늘 기록 재생성 ────────────────────────
status, workforce = req("POST", "/rest/v1/rpc/refresh_demo_clinic_workforce", {})
if status != 200:
    print(f"FAIL workforce demo refresh: {status} {workforce}")
    sys.exit(1)
print(f"8. 근태관리 데모: {workforce}")

# ── 9. 최종 요약 ─────────────────────────────────────────────────────────────
for label, path in [
    ("오늘 확정(in_progress)", f"/rest/v1/shifts?notes=like.DEMO-SHOWCASE-MATCHED-*&shift_date=eq.{TODAY}&select=id"),
    ("오늘 모집(open)", f"/rest/v1/shifts?notes=like.DEMO-SHOWCASE-OPEN-*&shift_date=eq.{TODAY}&select=id"),
]:
    _, rows2 = req("GET", path)
    print(f"   {label}: {len(rows2)}건")
print("완료 — sales-demo-1/2/3@demo.atman.co.kr / Atman-demo-2026!")
