"""Reset Demo 1 for a fresh W여성병원 end-to-end test.

Keeps the login account, profile, region, verified RN license and demo bank
account. Removes only today's/future W여성병원 workflow rows for this worker.
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
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
    return values


env = load_env("apps/worker-web/.env.local")
env.update({k: v for k, v in load_env("apps/admin-web/.env.local").items() if k not in env})
base = (env.get("SUPABASE_URL") or env["NEXT_PUBLIC_SUPABASE_URL"]).rstrip("/")
service = env["SUPABASE_SERVICE_ROLE_KEY"]


def req(method, path, body=None, prefer=None):
    headers = {"apikey": service, "Authorization": "Bearer " + service, "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None


def first(path, label):
    status, rows = req("GET", path)
    if status != 200 or not rows:
        raise RuntimeError(label + " not found, status=" + str(status))
    return rows[0]


status, account_page = req("GET", "/auth/v1/admin/users?email=worker-demo-1%40demo.atman.co.kr")
account = next((user for user in (account_page or {}).get("users", []) if user.get("email") == "worker-demo-1@demo.atman.co.kr"), None)
if status != 200 or not account:
    raise RuntimeError("Demo 1 account not found, status=" + str(status))
auth_id = account["id"]
worker = first("/rest/v1/workers?auth_user_id=eq." + auth_id + "&select=id,license_photo_url", "Demo 1 worker")
facility = first("/rest/v1/facilities?name=eq." + urllib.parse.quote("W여성병원") + "&is_demo=eq.true&select=id", "W facility")

# Keep onboarding complete and pre-fill the three pieces needed for the test.
req("PATCH", "/rest/v1/profiles?id=eq." + auth_id, {"role": "worker", "onboarding_done": True})
req("PATCH", "/rest/v1/workers?id=eq." + worker["id"], {
    "role": "rn",
    "license_number": "DEMO-RN-0001",
    "verification_status": "approved",
    "verified_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    "activity_address_text": "광주 광산구",
    "activity_radius_meters": 10000,
    "is_demo": True,
    "deleted_at": None,
})
req("POST", "/rest/v1/worker_location_prefs?on_conflict=worker_id", [{
    "worker_id": auth_id,
    "locations": [{"label": "광주 광산구", "radius_km": 10, "lat": 35.1900, "lng": 126.8252}],
}], prefer="resolution=merge-duplicates")

# Ensure a safe demo-only account summary exists (migration normally creates it).
status, banks = req("GET", "/rest/v1/worker_bank_accounts?worker_id=eq." + worker["id"] + "&is_primary=eq.true&deleted_at=is.null&select=id")
if status != 200 or not banks:
    raise RuntimeError("Demo 1 bank account is missing; apply migrations first")

today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat()
status, applications = req("GET", "/rest/v1/shift_applications?worker_id=eq." + worker["id"] + "&select=id,shift_id,shifts(facility_id,shift_date)")
reset_count = 0
for application in applications or []:
    shift = application.get("shifts") or {}
    if shift.get("facility_id") != facility["id"] or shift.get("shift_date", "") < today:
        continue
    app_id = application["id"]
    shift_id = application["shift_id"]
    _, attendance = req("GET", "/rest/v1/shift_attendances?application_id=eq." + app_id + "&select=id")
    for row in attendance or []:
        req("DELETE", "/rest/v1/wage_payment_instructions?attendance_id=eq." + row["id"])
        req("DELETE", "/rest/v1/wage_calculations?attendance_id=eq." + row["id"])
    req("DELETE", "/rest/v1/chat_messages?application_id=eq." + app_id)
    req("DELETE", "/rest/v1/shift_attendances?application_id=eq." + app_id)
    req("DELETE", "/rest/v1/shift_applications?id=eq." + app_id)
    req("PATCH", "/rest/v1/shifts?id=eq." + shift_id + "&matched_worker_id=eq." + worker["id"], {
        "matched_worker_id": None, "matched_at": None, "status": "open",
    })
    reset_count += 1

# Remove a current staff conversion so the conversion step can be demonstrated again.
req("DELETE", "/rest/v1/facility_staff?facility_id=eq." + facility["id"] + "&worker_id=eq." + worker["id"])

print("Demo 1 reset complete")
print("region=광주 광산구 radius=10km")
print("license=DEMO-RN-0001 status=approved")
print("bank=registered demo account")
print("today_or_future_applications_reset=" + str(reset_count))
