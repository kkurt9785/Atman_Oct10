-- 2026-11-05 병원 4인 QA(docs/QA_2026-11-05_병원_4인.md) DB 묶음 + 결정 4건(법령·판례·서비스 조사) 반영
-- 운영 적용은 사용자: supabase db push --linked. 앱 코드는 이 컬럼·함수가 없어도 동작하게 짰다(배포 순서 무관).
-- 핵심 패치(목록 필터·정산 휴게)는 앵커가 없으면 중단하고, 문구·시연 데이터 정리는 없으면 건너뛴다.

-- ── ① 근무자 사업장 시트: 약국 정보 컬럼 4개를 근무자 컬럼 권한에 추가(개인정보 아님). 빠져 있어서 시트 전체가 403이었다
GRANT SELECT (pharmacy_type, pharmacy_system, average_daily_prescriptions, handover_minutes) ON public.facilities TO authenticated;

-- ── ② 근무자 근태 달력: 본인 공고 근무의 정산 분만 돌려준다.
--    운영에서 근무자가 wage_calculations 를 직접 읽으면 'permission denied for table facilities'(레포 정책 2개로는 설명 안 됨) — 표 권한과 무관하게 본인 것만
CREATE OR REPLACE FUNCTION public.get_my_shift_settlement_minutes(p_attendance_ids uuid[])
RETURNS TABLE(attendance_id uuid, worked_minutes integer, break_minutes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT wc.attendance_id, wc.worked_minutes, wc.break_minutes
  FROM public.wage_calculations wc
  WHERE wc.attendance_id = ANY(p_attendance_ids)
    AND wc.worker_id = public.current_worker_id()
  LIMIT 1000
$$;
REVOKE ALL ON FUNCTION public.get_my_shift_settlement_minutes(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_shift_settlement_minutes(uuid[]) TO authenticated;

-- ── ③ 운영자 '게재 중지'(직업안정법 대응 문서 3절의 승인 취소) — 허위로 확인된 사업장의 공고를 내리고 새 공고를 막는다. 해제하면 되돌아온다
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS posting_suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS posting_suspended_reason text CHECK (posting_suspended_reason IS NULL OR char_length(posting_suspended_reason) <= 300);
COMMENT ON COLUMN public.facilities.posting_suspended_at IS '운영자 게재 중지 — 공고 목록·공개 페이지에서 숨기고 새 공고·공개 전환을 막는다(admin lib/posting-gate.ts)';

-- ── ④ 공고 목록·지도·공개 공고: 국세청 휴업·폐업·미등록, 셀프 미승인, 게재 중지 사업장의 '이미 열린' 공고도 내린다(지금까진 등록 때만 막음)
DO $patch$
DECLARE
  r record; v_def text; v_new text; v_seen integer := 0;
  v_cond text := 'f.deleted_at IS NULL AND COALESCE(f.business_status, '''') NOT IN (''closed'', ''suspended'', ''unknown'') AND f.posting_suspended_at IS NULL AND (f.approved_at IS NOT NULL OR COALESCE(f.registration_source, ''invite'') NOT LIKE ''self_%'')';
BEGIN
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('get_nearby_open_shifts_secure', 'list_public_shifts', 'get_public_shift')
  LOOP
    v_seen := v_seen + 1;
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%posting_suspended_at%' THEN CONTINUE; END IF; -- 이미 적용됨
    v_new := replace(v_def, 'f.deleted_at IS NULL', v_cond);
    IF v_new = v_def THEN RAISE EXCEPTION 'hospital_qa_1105: % source drifted (f.deleted_at anchor not found)', r.proname; END IF;
    EXECUTE v_new;
  END LOOP;
  IF v_seen < 3 THEN RAISE EXCEPTION 'hospital_qa_1105: listing functions missing (found %)', v_seen; END IF;
END $patch$;

-- ── ⑤ 공고 신고(결정 3): 로그인 계정은 모두 계속 받되 신고자 구분을 남기고, 자기 사업장 신고는 거부, 사업장 관리자는 하루 3건
ALTER TABLE public.job_posting_reports
  ADD COLUMN IF NOT EXISTS reporter_kind text NOT NULL DEFAULT 'worker' CHECK (reporter_kind IN ('worker', 'facility_admin'));
COMMENT ON COLUMN public.job_posting_reports.reporter_kind IS '신고 당시 사업장 관리 권한이 있었으면 facility_admin — 경쟁 사업장 보복 신고를 운영자가 가려 보게';

CREATE OR REPLACE FUNCTION public.report_job_posting(p_facility_id uuid, p_shift_id uuid, p_reason text, p_note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_zero uuid := '00000000-0000-0000-0000-000000000000';
  v_name text; v_shift text; v_id uuid; v_recent integer; v_kind text; v_limit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  IF public.is_demo_account(v_uid) THEN RAISE EXCEPTION '시연에서는 신고를 접수하지 않아요. 내 계정으로 이용해 주세요.'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('false_ad','wage_mismatch','contact_mismatch','identity','other')
     OR char_length(coalesce(p_note, '')) > 1000 THEN
    RAISE EXCEPTION '신고 사유와 내용을 확인해 주세요.';
  END IF;
  SELECT f.name INTO v_name FROM public.facilities f WHERE f.id = p_facility_id AND f.deleted_at IS NULL;
  IF v_name IS NULL THEN RAISE EXCEPTION '신고할 사업장을 찾지 못했어요.'; END IF;
  IF EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = p_facility_id AND f.admin_user_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.facility_admin_access a WHERE a.facility_id = p_facility_id AND a.user_id = v_uid) THEN
    RAISE EXCEPTION '내 사업장 공고는 신고할 수 없어요.';
  END IF;
  v_kind := CASE WHEN EXISTS (SELECT 1 FROM public.facilities f WHERE f.admin_user_id = v_uid AND f.deleted_at IS NULL)
                   OR EXISTS (SELECT 1 FROM public.facility_admin_access a WHERE a.user_id = v_uid)
                 THEN 'facility_admin' ELSE 'worker' END;
  v_limit := CASE WHEN v_kind = 'facility_admin' THEN 3 ELSE 10 END;
  IF p_shift_id IS NOT NULL THEN
    SELECT s.shift_date::text || ' ' || left(s.start_time::text, 5) || '~' || left(s.end_time::text, 5)
           || ' · ' || s.required_role || ' · 시급 ' || s.hourly_wage::text
      INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id AND s.facility_id = p_facility_id;
    IF v_shift IS NULL THEN RAISE EXCEPTION '신고할 공고를 찾지 못했어요.'; END IF;
  END IF;
  SELECT count(*) INTO v_recent FROM public.job_posting_reports
   WHERE reporter_user_id = v_uid AND created_at > now() - interval '1 day';
  IF v_recent >= v_limit THEN RAISE EXCEPTION '신고는 하루 %건까지 접수할 수 있어요.', v_limit; END IF;
  INSERT INTO public.job_posting_reports (reporter_user_id, facility_id, shift_id, reason, note, facility_name_snapshot, shift_snapshot, reporter_kind)
  VALUES (v_uid, p_facility_id, p_shift_id, p_reason, trim(coalesce(p_note, '')), v_name, v_shift, v_kind)
  -- 추론식은 인덱스 식과 글자 그대로 같아야 한다(변수 치환 불가)
  ON CONFLICT (reporter_user_id, facility_id, coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.job_posting_reports
     WHERE reporter_user_id = v_uid AND facility_id = p_facility_id AND coalesce(shift_id, v_zero) = coalesce(p_shift_id, v_zero);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_job_posting(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_job_posting(uuid, uuid, text, text) TO authenticated;

-- 신고자는 자기 신고의 처리 메모·검토자까지 읽을 수 있었다 → 상태까지만
REVOKE SELECT ON public.job_posting_reports FROM authenticated;
GRANT SELECT (id, reporter_user_id, facility_id, shift_id, reason, note, status, created_at) ON public.job_posting_reports TO authenticated;

-- 접수 후 1년 보관 뒤 파기(대화 신고와 같은 방식, 03:50 KST)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'job-posting-report-retention';
SELECT cron.schedule('job-posting-report-retention', '50 18 * * *', 'DELETE FROM public.job_posting_reports WHERE expires_at < now();');

-- ── ⑥ 채팅 24시간 잠금: 퇴근 기록이 없으면 영원히 열려 있었다 → 근무 종료 시각(야간이면 다음 날)부터 24시간
CREATE OR REPLACE FUNCTION public.chat_is_open(p_application_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shift_applications a
    JOIN public.shifts s ON s.id = a.shift_id
    WHERE a.id = p_application_id
      AND a.status IN ('accepted', 'completed')
      AND COALESCE(
            a.checked_out_at,
            ((s.shift_date + s.end_time
              + CASE WHEN s.is_overnight OR s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0' END)
             AT TIME ZONE 'Asia/Seoul')
          ) > now() - interval '24 hours'
  );
$$;
GRANT EXECUTE ON FUNCTION public.chat_is_open(uuid) TO authenticated;

-- ── ⑦ 휴게 차감(결정 2): 근로기준법 §54 법정 최소로 — 근무 구간 4:00 미만 0 / 4:00~8:29 30분 / 8:30 이상 60분.
--    8:00 구간에 60분을 빼면 실근로 7:30 근무를 7:00으로 계산해 과소지급이 된다(법제처 15-0847: 8시간 미만 근로는 30분이면 충족).
--    앱 lib/shared/gig-pay/shift-pay.ts calcBreakMinutes 와 같은 경계
CREATE OR REPLACE FUNCTION public.estimated_shift_pay(p_start time, p_end time, p_wage numeric)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_total integer; v_break integer;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_wage IS NULL OR p_wage <= 0 THEN RETURN NULL; END IF;
  v_total := (extract(epoch FROM (p_end - p_start)) / 60)::integer;
  IF v_total <= 0 THEN v_total := v_total + 1440; END IF;
  v_break := CASE WHEN v_total >= 510 THEN 60 WHEN v_total >= 240 THEN 30 ELSE 0 END;
  RETURN round((v_total - v_break) * p_wage / 60)::integer;
END $$;

-- 실제 정산(퇴근 → 급여 기록)도 같은 경계 — 예상액과 실지급이 어긋나지 않게
DO $patch$
DECLARE r record; v_def text; v_new text; v_hit boolean := false;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'calculate_shift_wage_secure'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%v_total >= 510 THEN 60%' THEN v_hit := true; CONTINUE; END IF;
    v_new := replace(v_def, 'v_total >= 480 THEN 60', 'v_total >= 510 THEN 60');
    IF v_new <> v_def THEN EXECUTE v_new; v_hit := true; END IF;
  END LOOP;
  IF NOT v_hit THEN RAISE EXCEPTION 'hospital_qa_1105: calculate_shift_wage_secure break anchor not found'; END IF;
  -- 옛 정산 경로(있을 때만)
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'checkout_and_settle'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'v_raw_min >= 480 THEN 60', 'v_raw_min >= 510 THEN 60');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END $patch$;

-- 모집 중인 공고 예상액을 새 경계로(8:00~8:29 구간만 30분어치 오른다). 단기·행사(긱) 현장은 별도 계약 조건이라 제외
UPDATE public.shifts s
SET estimated_total_pay = public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage), updated_at = now()
FROM public.facilities f
WHERE f.id = s.facility_id
  AND s.status = 'open'
  AND s.shift_date >= (timezone('Asia/Seoul', now()))::date
  AND COALESCE(f.facility_type, '') <> 'gigworker' AND COALESCE(f.registration_source, '') <> 'gigworker_trial'
  AND public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage) IS NOT NULL
  AND s.estimated_total_pay IS DISTINCT FROM public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage);

-- ── ⑧ 시연 약국 공고 예상액: 매일 다시 만드는 시드(refresh_demo_pharmacy_workforce)가 메모 접두어가 없어 트리거 밖이었다(152,000 → 133,000)
CREATE OR REPLACE FUNCTION public.demo_shift_estimated_pay_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = NEW.facility_id AND f.is_demo
             AND (NEW.notes LIKE 'DEMO-%' OR NEW.notes LIKE 'LIVE-SALES-DEMO%' OR f.facility_type = 'pharmacy')) THEN
    NEW.estimated_total_pay := coalesce(public.estimated_shift_pay(NEW.start_time, NEW.end_time, NEW.hourly_wage), NEW.estimated_total_pay);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.demo_shift_estimated_pay_trg() FROM PUBLIC, anon, authenticated;

UPDATE public.shifts s
SET estimated_total_pay = public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage), updated_at = now()
FROM public.facilities f
WHERE f.id = s.facility_id AND f.is_demo AND f.facility_type = 'pharmacy'
  AND s.status IN ('open', 'matched')
  AND public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage) IS NOT NULL
  AND s.estimated_total_pay IS DISTINCT FROM public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage);

-- ── ⑨ 서버 문구: 근무자 화면·관리자 알림에 그대로 보이는 격식체·'워커'·'관리자'(없으면 건너뜀)
DO $patch$
DECLARE r record; v_def text; v_new text;
BEGIN
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('enqueue_admin_worker_chat_message', 'record_unified_attendance')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '워커에게 메시지가 왔어요', '근무자 메시지가 왔어요');
    v_new := replace(v_new, 'COALESCE(v_worker_name,''워커'')', 'COALESCE(v_worker_name,''근무자'')');
    v_new := replace(v_new, '현재 위치를 정확하게 확인할 수 없습니다.', '현재 위치를 정확하게 확인하지 못했어요.');
    v_new := replace(v_new, '그 밖의 시간은 관리자에게 수동 기록을 요청해 주세요.', '그 밖의 시간은 사업장에 수동 기록을 요청해 주세요.');
    v_new := replace(v_new, '이 사업장은 관리자 승인 방식으로 운영 중이에요.', '이 사업장은 담당자가 출퇴근을 확인하는 방식이에요.');
    IF v_new <> v_def THEN EXECUTE v_new; ELSE RAISE NOTICE 'hospital_qa_1105: % 문구 앵커 없음(건너뜀)', r.proname; END IF;
  END LOOP;
END $patch$;

-- ── ⑩ 시연 월간 근태: 지각 행이 퇴근까지 찍힌 채 'late' 로 다시 생겨 급여(완료만 집계)와 갈라졌다 → 실제 퇴근 RPC처럼 completed + 지각 분
DO $patch$
DECLARE r record; v_def text; v_new text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'refresh_demo_care_month_history'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'WHEN engagement_type=''fixed_term'' AND seq IN (4,14) THEN ''late''', 'WHEN false THEN ''late''');
    IF v_new <> v_def THEN EXECUTE v_new; ELSE RAISE NOTICE 'hospital_qa_1105: 시연 월간 근태 앵커 없음(건너뜀)'; END IF;
  END LOOP;
END $patch$;

-- ── ⑪ 데이터 정리(실패해도 나머지는 적용) — 취소된 근무에 남은 확정·대타, 시연 이름·옛 시스템 문구·QA 대화, 시연 지각 행
DO $cleanup$
BEGIN
  BEGIN
    -- 사업장이 취소한 근무의 확정 지원(출근 전)은 취소로 — 근무자 앱에 '출근하기'가 남던 문제(앱도 이제 취소 때 같이 닫는다)
    UPDATE public.shift_applications a SET status = 'cancelled', responded_at = COALESCE(a.responded_at, now())
    FROM public.shifts s
    WHERE s.id = a.shift_id AND s.status = 'cancelled' AND a.status = 'accepted'
      AND a.checked_in_at IS NULL AND a.checked_out_at IS NULL;
    UPDATE public.shift_cover_requests c SET status = 'cancelled', decided_at = now(), updated_at = now()
    FROM public.shifts s
    WHERE s.id = c.shift_id AND s.status = 'cancelled' AND c.status IN ('open', 'claimed');
  EXCEPTION WHEN others THEN RAISE NOTICE 'hospital_qa_1105: 취소 근무 정리 건너뜀 — %', SQLERRM;
  END;
  BEGIN
    UPDATE public.workers SET name = replace(name, '데모워커', '시연 근무자')
    WHERE (is_demo OR kakao_id LIKE 'kakao_demo_%') AND name LIKE '%데모워커%';
  EXCEPTION WHEN others THEN RAISE NOTICE 'hospital_qa_1105: 시연 근무자 이름 건너뜀 — %', SQLERRM;
  END;
  BEGIN
    UPDATE public.chat_messages SET body = replace(body, '매칭이 확정됐어요', '채용이 확정됐어요')
    WHERE sender_type = 'system' AND body LIKE '%매칭이 확정됐어요%';
    DELETE FROM public.chat_messages m
    USING public.shift_applications a, public.shifts s, public.facilities f
    WHERE m.application_id = a.id AND a.shift_id = s.id AND s.facility_id = f.id AND f.is_demo
      AND m.body ~ '^\[?QA-1[01][0-9]{2}';
  EXCEPTION WHEN others THEN RAISE NOTICE 'hospital_qa_1105: 채팅 문구·QA 대화 정리 건너뜀 — %', SQLERRM;
  END;
  BEGIN
    UPDATE public.staff_attendances sa SET status = 'completed'
    FROM public.facilities f
    WHERE f.id = sa.facility_id AND f.is_demo AND sa.status = 'late' AND sa.check_out_at IS NOT NULL;
  EXCEPTION WHEN others THEN RAISE NOTICE 'hospital_qa_1105: 시연 지각 행 정리 건너뜀 — %', SQLERRM;
  END;
END $cleanup$;

-- ── ⑫ 근태 0일 월급 직원(결정 4b): 전액이 기본이되, 승인할 때 사업장이 확인한 금액(결근 공제, 월급 이하)을 받는다.
--    기록이 없다고 결근으로 단정하지 않는다(시프티·flex 모두 근무일정 대조·무급휴가 입력이 있어야 공제) — 화면이 '확인 필요'로 금액 입력을 요구
DO $patch$
DECLARE r record; v_def text; v_new text; v_hit boolean := false;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'transition_staff_wage_payment'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%v_days=0 AND coalesce(p_final_gross,0)>0%' THEN v_hit := true; CONTINUE; END IF;
    v_new := replace(v_def,
      'WHEN v_staff.pay_basis=''monthly'' THEN v_staff.pay_rate',
      'WHEN v_staff.pay_basis=''monthly'' AND v_days=0 AND coalesce(p_final_gross,0)>0 AND p_final_gross<=v_staff.pay_rate THEN p_final_gross WHEN v_staff.pay_basis=''monthly'' THEN v_staff.pay_rate');
    IF v_new <> v_def THEN EXECUTE v_new; v_hit := true; END IF;
  END LOOP;
  IF NOT v_hit THEN RAISE NOTICE 'hospital_qa_1105: transition_staff_wage_payment 앵커 없음(근태 0일 월급 금액 입력은 전액으로 처리됨)'; END IF;
END $patch$;
