"""Create one safe, completed W여성병원 payment for the worker-demo-1 showcase.

This is deliberately an idempotent service-role seeder, not a real transfer:
it creates only rows marked DEMO-1-PAYMENT-SHOWCASE and records a paid status
for the worker payment screen and its linked facility chat.
"""
import datetime as dt
import json
import urllib.error
import urllib.parse
import urllib.request


def load_env(path):
    values = {}
    with open(path, encoding="utf-8") as source:
        for raw in source:
            raw = raw.strip()
            if raw and not raw.startswith("#") and "=" in raw:
                key, value = raw.split("=", 1)
                values[key] = value
    return values


env = load_env("apps/worker-web/.env.local")
env.update({key: value for key, value in load_env("apps/admin-web/.env.local").items() if key not in env})
base = (env.get("SUPABASE_URL") or env["NEXT_PUBLIC_SUPABASE_URL"]).rstrip("/")
service = env["SUPABASE_SERVICE_ROLE_KEY"]


def request(method, path, body=None, prefer=None):
    headers = {"apikey": service, "Authorization": "Bearer " + service, "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    payload = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None


def one(path, label):
    status, rows = request("GET", path)
    if status != 200 or not rows:
        raise RuntimeError(f"{label} not found: {status} {rows}")
    return rows[0]


# The auth endpoint returns a page. Find the exact login identity rather than
# relying on a seed-specific worker ordering.
status, auth_page = request("GET", "/auth/v1/admin/users?page=1&per_page=1000")
if status != 200:
    raise RuntimeError(f"demo auth lookup failed: {status} {auth_page}")
user = next((row for row in (auth_page or {}).get("users", []) if row.get("email") == "worker-demo-1@demo.atman.co.kr"), None)
if not user:
    raise RuntimeError("worker-demo-1 auth user not found")

worker = one("/rest/v1/workers?auth_user_id=eq." + user["id"] + "&select=id,name", "demo worker")
facility = one("/rest/v1/facilities?name=eq." + urllib.parse.quote("W여성병원") + "&is_demo=eq.true&is_active=eq.true&select=id,name", "W여성병원")

today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()
shift_path = "/rest/v1/shifts?facility_id=eq." + facility["id"] + "&notes=eq.DEMO-1-PAYMENT-SHOWCASE&select=id"
status, rows = request("GET", shift_path)
if rows:
    shift_id = rows[0]["id"]
else:
    status, rows = request("POST", "/rest/v1/shifts", [{
        "facility_id": facility["id"], "required_role": "rn", "shift_date": (today - dt.timedelta(days=2)).isoformat(),
        "start_time": "09:00", "end_time": "17:00", "hourly_wage": 18000, "estimated_total_pay": 144000,
        "description": "시연용 완료 근무 · 출퇴근부터 사업장 직접 지급까지 확인합니다.", "department": "외래",
        "notes": "DEMO-1-PAYMENT-SHOWCASE", "status": "completed", "matched_worker_id": worker["id"],
        "matched_at": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).isoformat(), "audience": "public",
    }], prefer="return=representation")
    if status not in (200, 201) or not rows:
        raise RuntimeError(f"shift create failed: {status} {rows}")
    shift_id = rows[0]["id"]

status, apps = request("GET", "/rest/v1/shift_applications?shift_id=eq." + shift_id + "&worker_id=eq." + worker["id"] + "&select=id")
if apps:
    application_id = apps[0]["id"]
    request("PATCH", "/rest/v1/shift_applications?id=eq." + application_id, {"status": "accepted"})
else:
    status, apps = request("POST", "/rest/v1/shift_applications", [{
        "shift_id": shift_id, "worker_id": worker["id"], "status": "accepted", "match_score": 98,
        "applied_at": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).isoformat(),
        "responded_at": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2)).isoformat(),
    }], prefer="return=representation")
    if status not in (200, 201) or not apps:
        raise RuntimeError(f"application create failed: {status} {apps}")
    application_id = apps[0]["id"]

check_in = dt.datetime.combine(today - dt.timedelta(days=2), dt.time(8, 57), tzinfo=dt.timezone(dt.timedelta(hours=9))).isoformat()
check_out = dt.datetime.combine(today - dt.timedelta(days=2), dt.time(17, 3), tzinfo=dt.timezone(dt.timedelta(hours=9))).isoformat()
status, attendance_rows = request("GET", "/rest/v1/shift_attendances?application_id=eq." + application_id + "&select=id")
if attendance_rows:
    attendance_id = attendance_rows[0]["id"]
    request("PATCH", "/rest/v1/shift_attendances?id=eq." + attendance_id, {"check_in_at": check_in, "check_out_at": check_out, "check_in_method": "GPS", "check_out_method": "QR_FALLBACK"})
else:
    status, attendance_rows = request("POST", "/rest/v1/shift_attendances", [{
        "shift_id": shift_id, "worker_id": worker["id"], "application_id": application_id,
        "check_in_at": check_in, "check_out_at": check_out, "check_in_method": "GPS", "check_out_method": "QR_FALLBACK",
        "check_in_distance_m": 18, "check_out_distance_m": 14,
    }], prefer="return=representation")
    if status not in (200, 201) or not attendance_rows:
        raise RuntimeError(f"attendance create failed: {status} {attendance_rows}")
    attendance_id = attendance_rows[0]["id"]

payment = {
    "facility_id": facility["id"], "worker_id": worker["id"], "shift_id": shift_id, "attendance_id": attendance_id,
    "gross_amount": 144000, "deduction_status": "not_applicable", "net_amount": 144000,
    "due_date": (today - dt.timedelta(days=1)).isoformat(), "status": "paid",
    "paid_at": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).isoformat(),
    "payment_reference": "DEMO-PAID-ONLY",
}
status, _ = request("POST", "/rest/v1/wage_payment_instructions?on_conflict=attendance_id", [payment], prefer="resolution=merge-duplicates")
if status not in (200, 201, 204):
    raise RuntimeError(f"payment create failed: {status}")

messages = [
    "근무가 완료됐어요. 지급 상태는 앱에서 확인할 수 있어요.",
    "근무 확인 후 지급을 완료했습니다. 등록한 계좌의 입금 여부를 확인해 주세요.",
]
for sender_type, body in (("system", messages[0]), ("facility", messages[1])):
    status, existing = request("GET", "/rest/v1/chat_messages?application_id=eq." + application_id + "&body=eq." + urllib.parse.quote(body) + "&select=id")
    if not existing:
        request("POST", "/rest/v1/chat_messages", [{"application_id": application_id, "sender_type": sender_type, "body": body}])

print("Demo 1 payment showcase ready")
print("worker=" + worker["name"] + " / facility=" + facility["name"] + " / payment=paid / amount=144000")
