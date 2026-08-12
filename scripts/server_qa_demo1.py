"""Isolated production server QA for W여성병원 / Demo 1."""
import datetime as dt
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid


def env_file(path):
    out = {}
    with open(path, encoding="utf-8") as source:
        for raw in source:
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                out[key] = value
    return out


env = env_file("apps/worker-web/.env.local")
env.update({k: v for k, v in env_file("apps/admin-web/.env.local").items() if k not in env})
base = (env.get("SUPABASE_URL") or env["NEXT_PUBLIC_SUPABASE_URL"]).rstrip("/")
anon = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
service = env["SUPABASE_SERVICE_ROLE_KEY"]
password = "Atman-demo-2026!"


def req(method, path, body=None, token=None, prefer=None):
    key = service if token == service else anon
    headers = {"apikey": key, "Authorization": "Bearer " + (token or key), "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None


def login(email):
    status, data = req("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password})
    if status != 200:
        raise RuntimeError("login failed " + email + " status=" + str(status))
    return data["access_token"], data["user"]["id"]


def get_one(path, label):
    status, rows = req("GET", path, token=service)
    if status != 200 or not rows:
        raise RuntimeError(label + " missing status=" + str(status))
    return rows[0]


def rpc(token, name, body):
    return req("POST", "/rest/v1/rpc/" + name, body, token=token)


def passed(name, condition, detail=""):
    results.append((name, bool(condition), detail))


def free_window_for_today(worker_id, kst_now):
    """Pick a short attendance-test window that does not overlap accepted demo work."""
    today = kst_now.date().isoformat()
    path = (
        "/rest/v1/shift_applications?worker_id=eq." + worker_id
        + "&status=eq.accepted&select=shifts(shift_date,start_time,end_time)"
    )
    status, rows = req("GET", path, token=service)
    if status != 200:
        raise RuntimeError("accepted shift lookup failed status=" + str(status))
    occupied = []
    for row in rows or []:
        shift = row.get("shifts") or {}
        if shift.get("shift_date") != today:
            continue
        start_h, start_m = map(int, shift["start_time"][:5].split(":"))
        end_h, end_m = map(int, shift["end_time"][:5].split(":"))
        start_minute = start_h * 60 + start_m
        end_minute = end_h * 60 + end_m
        if end_minute <= start_minute:
            end_minute += 24 * 60
        occupied.append((start_minute, end_minute))

    now_minute = kst_now.hour * 60 + kst_now.minute
    for distance in range(0, 331, 15):
        for candidate in ({now_minute + distance, now_minute - distance} if distance else {now_minute}):
            start_minute = max(0, min(candidate - 5, 23 * 60 + 45))
            end_minute = start_minute + 10
            if all(end_minute <= busy_start or start_minute >= busy_end for busy_start, busy_end in occupied):
                return f"{start_minute // 60:02d}:{start_minute % 60:02d}", f"{end_minute // 60:02d}:{end_minute % 60:02d}"
    raise RuntimeError("Demo 1 has no free QA window within the attendance allowance")


results = []
shift_ids = []
application_ids = []
attendance_ids = []
challenge_ids = []
outbox_ids = []
template_ids = []
original_settings = None
try:
    worker_token, worker_uid = login("worker-demo-1@demo.atman.co.kr")
    other_token, _ = login("worker-demo-2@demo.atman.co.kr")
    admin_token, admin_uid = login("sales-demo-1@demo.atman.co.kr")
    worker = get_one("/rest/v1/workers?auth_user_id=eq." + worker_uid + "&select=id", "worker")
    facility = get_one("/rest/v1/facilities?name=eq." + urllib.parse.quote("W여성병원") + "&is_demo=eq.true&select=id", "facility")

    # Persistent demo readiness: the login identity, accepted application and chat must stay connected.
    demo_chat_shift = get_one("/rest/v1/shifts?facility_id=eq." + facility["id"] + "&notes=eq.DEMO-1-CHAT-SHOWCASE&select=id,matched_worker_id,status", "demo chat shift")
    _, demo_chat_apps = req("GET", "/rest/v1/shift_applications?shift_id=eq." + demo_chat_shift["id"] + "&worker_id=eq." + worker["id"] + "&status=eq.accepted&select=id", token=service)
    demo_chat_app = demo_chat_apps[0] if demo_chat_apps else None
    passed("7-1 demo-1 확정 지원 보장", demo_chat_shift.get("matched_worker_id") == worker["id"] and demo_chat_shift.get("status") == "matched" and demo_chat_app is not None)
    _, demo_messages = req("GET", "/rest/v1/chat_messages?application_id=eq." + (demo_chat_app or {}).get("id", "00000000-0000-0000-0000-000000000000") + "&select=id", token=service)
    passed("7-2 demo-1 시연 채팅 보장", len(demo_messages or []) >= 3)

    # Preserve attendance settings; force deterministic server checks.
    _, setting_rows = req("GET", "/rest/v1/facility_attendance_settings?facility_id=eq." + facility["id"] + "&select=*", token=service)
    original_settings = setting_rows[0] if setting_rows else None
    req("POST", "/rest/v1/facility_attendance_settings?on_conflict=facility_id", [{
        "facility_id": facility["id"], "authentication_mode": "gps",
        "gps_radius_meters": 30, "max_gps_accuracy_meters": 80,
        "qr_fallback_enabled": True, "check_in_before_minutes": 360,
        "check_in_after_minutes": 360, "check_out_before_minutes": 360,
        "check_out_after_minutes": 360,
    }], token=service, prefer="resolution=merge-duplicates")

    kst = dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))
    today = kst.date().isoformat()
    start, end = free_window_for_today(worker["id"], kst)
    weekday = kst.isoweekday()
    status, template_rows = req("POST", "/rest/v1/shift_templates", [{
        "facility_id": facility["id"], "name": "E2E-QA 7일 공백",
        "required_role": "rn", "weekdays": [weekday], "start_time": start,
        "end_time": end, "hourly_wage": 18000, "description": "E2E-QA 공백 자동모집",
        "department": "QA", "required_headcount": 1, "created_by": admin_uid,
    }], token=service, prefer="return=representation")
    if status != 201:
        raise RuntimeError("shift template create failed " + str(template_rows))
    template_id = template_rows[0]["id"]
    template_ids.append(template_id)
    batch_id = str(uuid.uuid4())
    status, rows = req("POST", "/rest/v1/shifts", [{
        "facility_id": facility["id"], "required_role": "rn", "shift_date": today,
        "start_time": start, "end_time": end, "hourly_wage": 18000,
        "estimated_total_pay": 3000, "description": "E2E-QA 서버 검증",
        "department": "QA", "notes": "E2E-QA-DEMO1", "status": "open",
        "template_id": template_id, "template_slot": 1, "generation_batch_id": batch_id,
    }], token=service, prefer="return=representation")
    if status != 201:
        raise RuntimeError("shift create failed " + str(rows))
    shift_id = rows[0]["id"]
    shift_ids.append(shift_id)
    link_status, linked_rows = req("GET", "/rest/v1/shifts?id=eq." + shift_id + "&template_id=eq." + template_id + "&generation_batch_id=eq." + batch_id + "&template_slot=eq.1&select=id", token=service)
    passed("6-0 반복 근무 공백 생성", link_status == 200 and len(linked_rows or []) == 1)

    # 6. New shift notification path: recipient selection -> durable outbox -> worker visibility.
    recipient_status, recipients = rpc(service, "get_shift_notification_recipients", {"p_shift_id": shift_id})
    recipient_uids = {row.get("auth_user_id") for row in (recipients or [])}
    passed("6-1 알림 대상 워커 선정", recipient_status == 200 and worker_uid in recipient_uids)
    dedupe_key = "e2e.qa.shift.created:" + uuid.uuid4().hex
    outbox_status, outbox_rows = req("POST", "/rest/v1/notification_outbox", [{
        "worker_auth_user_id": worker_uid, "event_type": "shift.created",
        "dedupe_key": dedupe_key, "title": "E2E-QA 새 근무", "body": "서버 알림 연동 검증",
        "data": {"type": "new_shift", "shiftId": shift_id},
    }], token=service, prefer="return=representation")
    if outbox_status == 201 and outbox_rows:
        outbox_ids.append(outbox_rows[0]["id"])
    passed("6-2 알림 outbox 저장", outbox_status == 201 and len(outbox_rows or []) == 1)
    visibility_status, visible_rows = req("GET", "/rest/v1/shifts?id=eq." + shift_id + "&select=id,status", token=worker_token)
    passed("6-3 워커 공고 노출", visibility_status == 200 and len(visible_rows or []) == 1 and visible_rows[0]["status"] == "open")

    # 1. Duplicate and state transitions.
    s1, app_id = rpc(worker_token, "apply_to_shift", {"p_shift_id": shift_id})
    if s1 != 200 or not isinstance(app_id, str):
        raise RuntimeError("initial application failed status={} response={}".format(s1, app_id))
    application_ids.append(app_id)
    s2, e2 = rpc(worker_token, "apply_to_shift", {"p_shift_id": shift_id})
    passed("1-1 최초 지원", s1 == 200)
    passed("1-2 중복 지원 차단", s2 >= 400 and "이미 지원" in str(e2))
    sc1, c1 = rpc(worker_token, "cancel_my_shift_application", {"p_application_id": app_id})
    sc2, c2 = rpc(worker_token, "cancel_my_shift_application", {"p_application_id": app_id})
    passed("3-1 지원 취소", sc1 == 200 and c1 is True)
    passed("3-2 중복 취소 무변경", sc2 == 200 and c2 is False)
    rpc(worker_token, "apply_to_shift", {"p_shift_id": shift_id})
    sr1, r1 = rpc(admin_token, "reject_shift_application", {"p_application_id": app_id})
    sr2, r2 = rpc(admin_token, "reject_shift_application", {"p_application_id": app_id})
    passed("3-3 관리자 거절", sr1 == 200 and r1 is True)
    passed("3-4 중복 거절 차단", sr2 >= 400)
    rpc(worker_token, "apply_to_shift", {"p_shift_id": shift_id})
    sa1, _ = rpc(admin_token, "accept_shift_application", {"p_application_id": app_id})
    sa2, _ = rpc(admin_token, "accept_shift_application", {"p_application_id": app_id})
    passed("1-3 관리자 수락", sa1 == 200)
    passed("1-4 중복 수락 차단", sa2 >= 400)

    # 2. Chat authorization, masking, and lock.
    sw, worker_message = rpc(worker_token, "send_chat_message", {"p_application_id": app_id, "p_body": "QA 010-1234-5678 계좌 1234567890"})
    sa, _ = rpc(admin_token, "send_chat_message", {"p_application_id": app_id, "p_body": "병원 QA 답변"})
    su, _ = rpc(other_token, "send_chat_message", {"p_application_id": app_id, "p_body": "권한 없는 접근"})
    masked_body = (worker_message or {}).get("body", "") if isinstance(worker_message, dict) else ""
    passed("2-1 양방향 채팅", sw == 200 and sa == 200)
    passed("2-2 타 워커 접근 차단", su >= 400)
    passed("2-3 연락처·계좌 마스킹", "01*-****-****" in masked_body and "********" in masked_body)
    req("PATCH", "/rest/v1/shift_applications?id=eq." + app_id, {"checked_out_at": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=25)).isoformat(), "status": "completed"}, token=service)
    sl, _ = rpc(worker_token, "send_chat_message", {"p_application_id": app_id, "p_body": "잠금 테스트"})
    passed("2-4 종료 24시간 잠금", sl >= 400)
    req("PATCH", "/rest/v1/shift_applications?id=eq." + app_id, {"checked_out_at": None, "status": "accepted"}, token=service)

    # 5. Attendance server failures.
    _, out_range = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": app_id, "p_action": "check_in", "p_lat": 0, "p_lng": 0, "p_accuracy": 10, "p_qr_token": None})
    _, low_accuracy = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": app_id, "p_action": "check_in", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 500, "p_qr_token": None})
    _, unassigned = rpc(other_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": app_id, "p_action": "check_in", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": None})
    passed("5-1 병원 반경 밖 차단", out_range.get("reason") == "OUT_OF_RANGE")
    passed("5-2 GPS 정확도 낮음 차단", low_accuracy.get("reason") == "GPS_ACCURACY_LOW")
    passed("5-3 배정되지 않은 워커 차단", unassigned.get("reason") == "NOT_ASSIGNED")

    # Successful attendance and duplicate guards; checkout trigger must create one payment.
    _, checkin = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": app_id, "p_action": "check_in", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": None})
    _, dup_in = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": app_id, "p_action": "check_in", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": None})
    _, checkout = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": app_id, "p_action": "check_out", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": None})
    _, dup_out = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": app_id, "p_action": "check_out", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": None})
    attendance_id = checkout.get("attendanceId")
    if attendance_id:
        attendance_ids.append(attendance_id)
    passed("1-5 중복 출근 차단", checkin.get("ok") is True and dup_in.get("reason") == "DUPLICATE_ATTENDANCE")
    passed("1-6 중복 퇴근 차단", checkout.get("ok") is True and dup_out.get("reason") == "DUPLICATE_ATTENDANCE")
    _, wages = req("GET", "/rest/v1/wage_calculations?attendance_id=eq." + attendance_id + "&select=id,gross", token=service)
    _, payments = req("GET", "/rest/v1/wage_payment_instructions?attendance_id=eq." + attendance_id + "&select=id,status", token=service)
    passed("4-1 임금 자동 계산", len(wages or []) == 1)
    passed("4-2 지급 요청 단일 생성", len(payments or []) == 1 and payments[0]["status"] == "draft")

    # QR invalid under combined policy; auth log must persist failures.
    req("PATCH", "/rest/v1/facility_attendance_settings?facility_id=eq." + facility["id"], {"authentication_mode": "gps_qr"}, token=service)
    # Use a fresh accepted test application because the first one is completed.
    tomorrow = (kst.date() + dt.timedelta(days=1)).isoformat()
    status, rows = req("POST", "/rest/v1/shifts", [{"facility_id": facility["id"], "required_role": "rn", "shift_date": tomorrow, "start_time": "09:00", "end_time": "18:00", "hourly_wage": 18000, "estimated_total_pay": 162000, "description": "E2E-QA QR", "department": "QA", "notes": "E2E-QA-QR", "status": "matched", "matched_worker_id": worker["id"]}], token=service, prefer="return=representation")
    qr_shift = rows[0]["id"]; shift_ids.append(qr_shift)
    status, rows = req("POST", "/rest/v1/shift_applications", [{"shift_id": qr_shift, "worker_id": worker["id"], "status": "accepted"}], token=service, prefer="return=representation")
    qr_app = rows[0]["id"]; application_ids.append(qr_app)
    _, invalid_qr = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": qr_app, "p_action": "check_in", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": "X" * 40})
    passed("5-4 잘못된 QR 차단", invalid_qr.get("reason") == "QR_INVALID")

    expired_token = "expired-" + uuid.uuid4().hex
    mismatch_token = "mismatch-" + uuid.uuid4().hex
    now_utc = dt.datetime.now(dt.timezone.utc)
    other_facility = get_one("/rest/v1/facilities?id=neq." + facility["id"] + "&is_demo=eq.true&is_active=eq.true&select=id", "other facility")
    for target_facility, token_value, issued, expires in [
        (facility["id"], expired_token, now_utc - dt.timedelta(minutes=2), now_utc - dt.timedelta(minutes=1)),
        (other_facility["id"], mismatch_token, now_utc, now_utc + dt.timedelta(minutes=2)),
    ]:
        status, rows = req("POST", "/rest/v1/facility_attendance_qr_challenges", [{
            "facility_id": target_facility,
            "token_hash": hashlib.sha256(token_value.encode()).hexdigest(),
            "issued_at": issued.isoformat(), "expires_at": expires.isoformat(),
            "issued_by": admin_uid,
        }], token=service, prefer="return=representation")
        if status != 201:
            raise RuntimeError("challenge insert failed " + str(rows))
        challenge_ids.append(rows[0]["id"])
    _, expired_qr = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": qr_app, "p_action": "check_in", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": expired_token})
    _, mismatch_qr = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": qr_app, "p_action": "check_in", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": mismatch_token})
    passed("5-5 만료 QR 차단", expired_qr.get("reason") == "QR_EXPIRED")
    passed("5-6 다른 병원 QR 차단", mismatch_qr.get("reason") == "HOSPITAL_MISMATCH")

    # Valid authentication but no check-in must still reject checkout.
    valid_rows_status, valid_rows = rpc(admin_token, "issue_facility_attendance_qr", {"p_facility_id": facility["id"]})
    valid_token = valid_rows[0]["token"] if isinstance(valid_rows, list) else valid_rows.get("token")
    status, rows = req("POST", "/rest/v1/shifts", [{"facility_id": facility["id"], "required_role": "rn", "shift_date": today, "start_time": start, "end_time": end, "hourly_wage": 18000, "estimated_total_pay": 3000, "description": "E2E-QA no checkin", "department": "QA", "notes": "E2E-QA-NO-CHECKIN", "status": "matched", "matched_worker_id": worker["id"]}], token=service, prefer="return=representation")
    no_in_shift = rows[0]["id"]; shift_ids.append(no_in_shift)
    status, rows = req("POST", "/rest/v1/shift_applications", [{"shift_id": no_in_shift, "worker_id": worker["id"], "status": "accepted"}], token=service, prefer="return=representation")
    no_in_app = rows[0]["id"]; application_ids.append(no_in_app)
    _, no_checkin = rpc(worker_token, "record_unified_attendance", {"p_target_type": "shift", "p_target_id": no_in_app, "p_action": "check_out", "p_lat": 35.1900, "p_lng": 126.8252, "p_accuracy": 10, "p_qr_token": valid_token})
    passed("5-7 출근 없는 퇴근 차단", no_checkin.get("reason") == "INVALID_STATE")
    _, logs = req("GET", "/rest/v1/attendance_auth_logs?application_id=in.(" + app_id + "," + qr_app + ")&result=eq.FAIL&select=id,failure_reason", token=service)
    reasons = {row["failure_reason"] for row in logs or []}
    passed("5-8 인증 실패 감사로그", {"OUT_OF_RANGE", "GPS_ACCURACY_LOW", "QR_INVALID", "QR_EXPIRED", "HOSPITAL_MISMATCH"}.issubset(reasons))
finally:
    # Restore settings before deleting isolated QA rows.
    if original_settings:
        restore = {k: v for k, v in original_settings.items() if k not in ("created_at", "updated_at")}
        req("POST", "/rest/v1/facility_attendance_settings?on_conflict=facility_id", [restore], token=service, prefer="resolution=merge-duplicates")
    for app_id in application_ids:
        _, atts = req("GET", "/rest/v1/shift_attendances?application_id=eq." + str(app_id) + "&select=id", token=service)
        for att in atts or []:
            req("DELETE", "/rest/v1/wage_payment_instructions?attendance_id=eq." + att["id"], token=service)
            req("DELETE", "/rest/v1/wage_calculations?attendance_id=eq." + att["id"], token=service)
        req("DELETE", "/rest/v1/attendance_auth_logs?application_id=eq." + str(app_id), token=service)
        req("DELETE", "/rest/v1/chat_messages?application_id=eq." + str(app_id), token=service)
        req("DELETE", "/rest/v1/shift_attendances?application_id=eq." + str(app_id), token=service)
        req("DELETE", "/rest/v1/shift_applications?id=eq." + str(app_id), token=service)
    for shift_id in shift_ids:
        req("DELETE", "/rest/v1/shifts?id=eq." + str(shift_id), token=service)
    for challenge_id in challenge_ids:
        req("DELETE", "/rest/v1/facility_attendance_qr_challenges?id=eq." + challenge_id, token=service)
    for outbox_id in outbox_ids:
        req("DELETE", "/rest/v1/notification_outbox?id=eq." + outbox_id, token=service)
    for template_id in template_ids:
        req("DELETE", "/rest/v1/shift_templates?id=eq." + template_id, token=service)

for name, ok, detail in results:
    print(("PASS" if ok else "FAIL") + " " + name + ((" · " + detail) if detail else ""))
failed = [name for name, ok, _ in results if not ok]
print("SUMMARY total={} pass={} fail={}".format(len(results), len(results) - len(failed), len(failed)))
if failed:
    raise SystemExit(1)
