-- 개인정보 보관 기간이 지나면 실제로 파기·익명 처리 (개인정보 처리방침 제3조)
--
-- 이미 돌고 있는 것: 출퇴근 좌표 90일 삭제, 출퇴근 인증 기록 3년 삭제 (apply_attendance_location_retention)
-- 이번에 더하는 것:
--   ① 근무일로부터 3년 지난 출퇴근 기록의 '사업장까지의 거리·측위 정확도' 삭제
--   ② 탈퇴 후 3년 지난 근무자 익명 처리 — 이름·생년·경력·부서, 계좌 끝자리, 동의 기록, 근무 관련 대화
--      (근무·출퇴근·지급 기록의 행 자체는 사업장의 근로관계 이력·정산 집계라 남기되 사람을 알아볼 수 없게 한다)
-- 워크룸(긱) 대화는 로그인 계정이 지워지면 보낸 사람 연결이 끊기므로, 탈퇴할 때 표시를 남겨 둔다.

ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

-- 탈퇴 시 워크룸 대화에 탈퇴자 표시 (로그인 계정 삭제 직전)
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.withdraw_my_account()'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%withdrawn_worker_id%' THEN
    v_new := replace(v_def,
      'DELETE FROM auth.users WHERE id = v_uid;',
      E'IF v_worker.id IS NOT NULL THEN\n    UPDATE public.facility_workroom_messages\n    SET metadata = metadata || jsonb_build_object(''withdrawn_worker_id'', v_worker.id)\n    WHERE sender_user_id = v_uid;\n  END IF;\n\n  DELETE FROM auth.users WHERE id = v_uid;');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'personal_data_retention: withdraw_my_account source drifted';
    END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;

CREATE OR REPLACE FUNCTION public.apply_personal_data_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff_date date := (timezone('Asia/Seoul', now()))::date - interval '3 years';
  v_cutoff timestamptz := now() - interval '3 years';
  v_staff integer := 0;
  v_shift integer := 0;
  v_anonymized integer := 0;
  r record;
BEGIN
  -- ① 3년 지난 출퇴근: 사업장까지의 거리·측위 정확도
  UPDATE public.staff_attendances
  SET check_in_distance_m = NULL, check_out_distance_m = NULL,
      check_in_gps_accuracy_m = NULL, check_out_gps_accuracy_m = NULL
  WHERE work_date < v_cutoff_date
    AND (check_in_distance_m IS NOT NULL OR check_out_distance_m IS NOT NULL
         OR check_in_gps_accuracy_m IS NOT NULL OR check_out_gps_accuracy_m IS NOT NULL);
  GET DIAGNOSTICS v_staff = ROW_COUNT;

  UPDATE public.shift_attendances AS a
  SET check_in_distance_m = NULL, check_out_distance_m = NULL,
      check_in_gps_accuracy_m = NULL, check_out_gps_accuracy_m = NULL
  FROM public.shifts AS s
  WHERE s.id = a.shift_id AND s.shift_date < v_cutoff_date
    AND (a.check_in_distance_m IS NOT NULL OR a.check_out_distance_m IS NOT NULL
         OR a.check_in_gps_accuracy_m IS NOT NULL OR a.check_out_gps_accuracy_m IS NOT NULL);
  GET DIAGNOSTICS v_shift = ROW_COUNT;

  -- ② 탈퇴 후 3년 지난 근무자 익명 처리 (한 번에 500명씩 — 매일 돈다)
  FOR r IN
    SELECT id FROM public.workers
    WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff AND anonymized_at IS NULL
    ORDER BY deleted_at
    LIMIT 500
  LOOP
    UPDATE public.workers
    SET name = '탈퇴한 회원', birth_date = DATE '1900-01-01', experience_years = NULL,
        department_tags = '{}'::text[], anonymized_at = now()
    WHERE id = r.id;
    UPDATE public.worker_bank_accounts SET account_number_last4 = '****' WHERE worker_id = r.id;
    DELETE FROM public.worker_consents WHERE worker_id = r.id;
    UPDATE public.chat_messages AS m
    SET body = '(보관 기간이 지나 삭제된 메시지)'
    FROM public.shift_applications AS a
    WHERE a.id = m.application_id AND a.worker_id = r.id AND m.sender_type <> 'system';
    UPDATE public.facility_workroom_messages
    SET sender_name = '탈퇴한 회원', body = '(보관 기간이 지나 삭제된 메시지)',
        metadata = (metadata - 'withdrawn_worker_id') || jsonb_build_object('anonymized', true)
    WHERE metadata->>'withdrawn_worker_id' = r.id::text;
    v_anonymized := v_anonymized + 1;
  END LOOP;

  RETURN jsonb_build_object('staff_distance_cleared', v_staff, 'shift_distance_cleared', v_shift, 'workers_anonymized', v_anonymized);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_personal_data_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_personal_data_retention() TO service_role;

-- 매일 00:35(KST) — 좌표 90일 정리(00:25) 다음
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'personal_data_retention_daily';
    PERFORM cron.schedule('personal_data_retention_daily', '35 15 * * *', 'select public.apply_personal_data_retention();');
  END IF;
END
$cron$;
