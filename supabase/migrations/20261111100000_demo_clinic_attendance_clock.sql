-- 시연 병원·의원 '오늘 근태' 시각을 근무 시작 기준으로 (2026-11-11 토요일 영업 전 회귀에서 발견)
--   · 지금까지: 매일 00:10 과 아침 9시쯤 다시 채울 때 "지금 − 9시간/4시간/2시간/1시간"으로 넣어
--     09~18시 근무자가 "출근 00:09 → 퇴근 08:09"로 보였다.
--   · 바꿈: 출근·퇴근 시각을 그날 근무 시작·끝 기준으로 넣는다(김민서 08:52 출근 식).
--     아직 오지 않은 시각은 넣지 않는다(LEAST(…, now() − 몇 분)).
--   · 아침 9시에도 '퇴근 완료'·'조기퇴근 승인 대기'가 말이 되려면 그 전에 일이 끝나야 해서 두 사람 근무시간을 바꾼다.
--       박서윤 처치실 09:00~18:00 → 병동 야간 00:00~08:00 (전날 23:54 출근 → 08:04 퇴근)
--       최하은 검진센터 10:00~19:00 → 07:30~16:30 (07:26 출근 → 08:40 조기퇴근 요청)
--   · 시연 직원 근무 요일 월~금 → 월~토 (토요일 시연 때 주간 근무표가 전원 휴무로 보이지 않게)
--   · 시연 반차 신청에 오후 표시(half_day_period = 'pm')
-- 방식: 20260730100000 처럼 운영에 있는 함수 정의를 읽어 그 줄만 바꾼다.
--       찾는 줄이 정확히 한 번 나오지 않으면 멈추고 아무것도 바꾸지 않는다.

CREATE OR REPLACE FUNCTION pg_temp.patch_once(def text, old text, new text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE
  hits integer := (length(def) - length(replace(def, old, ''))) / length(old);
BEGIN
  IF hits <> 1 THEN RAISE EXCEPTION 'demo clock patch: expected 1 match, found % for: %', hits, old; END IF;
  RETURN replace(def, old, new);
END $fn$;

DO $patch$
DECLARE
  fn regprocedure := to_regprocedure('public.refresh_demo_clinic_workforce()');
  def text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'refresh_demo_clinic_workforce not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%병동 야간%' THEN RAISE NOTICE 'demo clock patch skipped: already applied'; RETURN; END IF;

  -- 근무시간: 아침에 끝나는 두 사람
  def := pg_temp.patch_once(def,
    $o$(2, '박서윤', 'na', '처치실', 'regular', '09:00'::time, '18:00'::time),$o$,
    $n$(2, '박서윤', 'na', '병동 야간', 'regular', '00:00'::time, '08:00'::time),$n$);
  def := pg_temp.patch_once(def,
    $o$(4, '최하은', 'na', '검진센터', 'temporary', '10:00'::time, '19:00'::time),$o$,
    $n$(4, '최하은', 'na', '검진센터', 'temporary', '07:30'::time, '16:30'::time),$n$);

  -- 근무 요일: 월~토
  def := pg_temp.patch_once(def,
    $o$default_end_time, default_break_minutes, status$o$,
    $n$default_end_time, default_break_minutes, status, work_weekdays$n$);
  def := pg_temp.patch_once(def,
    $o$t.default_start, t.default_end, 60, 'active'$o$,
    $n$t.default_start, t.default_end, 60, 'active', ARRAY[1,2,3,4,5,6]::smallint[]$n$);

  -- 출근 시각: 근무 시작 기준
  def := pg_temp.patch_once(def,
    $o$WHEN phone LIKE '%-1' THEN now() - interval '2 hours'$o$,
    $n$WHEN phone LIKE '%-1' THEN LEAST(((v_today + default_start_time) AT TIME ZONE 'Asia/Seoul') - interval '8 minutes', now() - interval '3 minutes')$n$);
  def := pg_temp.patch_once(def,
    $o$WHEN phone LIKE '%-2' THEN now() - interval '9 hours'$o$,
    $n$WHEN phone LIKE '%-2' THEN LEAST(((v_today + default_start_time) AT TIME ZONE 'Asia/Seoul') - interval '6 minutes', now() - interval '5 minutes')$n$);
  def := pg_temp.patch_once(def,
    $o$WHEN phone LIKE '%-3' THEN now() - interval '1 hour'$o$,
    $n$WHEN phone LIKE '%-3' THEN LEAST(((v_today + default_start_time) AT TIME ZONE 'Asia/Seoul') + interval '9 minutes', now() - interval '3 minutes')$n$);
  def := pg_temp.patch_once(def,
    $o$WHEN phone LIKE '%-4' THEN now() - interval '4 hours'$o$,
    $n$WHEN phone LIKE '%-4' THEN LEAST(((v_today + default_start_time) AT TIME ZONE 'Asia/Seoul') - interval '4 minutes', now() - interval '20 minutes')$n$);

  -- 퇴근 시각(박서윤)·조기퇴근 요청 시각(최하은)
  def := pg_temp.patch_once(def,
    $o$CASE WHEN phone LIKE '%-2' THEN now() - interval '1 hour' END,$o$,
    $n$CASE WHEN phone LIKE '%-2' THEN LEAST(((v_today + default_end_time) AT TIME ZONE 'Asia/Seoul') + interval '4 minutes', now() - interval '2 minutes') END,$n$);
  def := pg_temp.patch_once(def,
    $o$CASE WHEN phone LIKE '%-4' THEN now() - interval '10 minutes' END,$o$,
    $n$CASE WHEN phone LIKE '%-4' THEN LEAST(((v_today + default_start_time) AT TIME ZONE 'Asia/Seoul') + interval '70 minutes', now() - interval '10 minutes') END,$n$);

  -- 시연 반차는 오후 반차로
  def := pg_temp.patch_once(def,
    $o$  RETURN QUERY$o$,
    $n$  UPDATE public.staff_leave_requests r SET half_day_period = 'pm'
  FROM public.facility_staff s
  WHERE s.id = r.staff_id AND s.phone LIKE 'DEMO-WF-%'
    AND r.leave_type = 'half_day' AND r.half_day_period IS NULL;

  RETURN QUERY$n$);

  EXECUTE def;
END $patch$;

-- 바로 반영. 직원을 다시 만들면 지난달 근태가 같이 지워지므로 매일 하는 순서대로 곧바로 되살린다.
SELECT * FROM public.refresh_demo_clinic_workforce();
SELECT * FROM public.refresh_anchor_demo_month_history();
SELECT * FROM public.refresh_demo_care_month_history();
