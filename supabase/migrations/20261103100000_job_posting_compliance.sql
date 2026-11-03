-- 직업안정법 제25조 개정(법률 제21787호, 2026-12-10 시행) 대응
--  ① 구직자에게 게재해야 하는 구인자 공표 정보: 체불사업주 명단 공개 중(근로기준법 §43의2) · 산업재해 발생건수 공표 사업장(산업안전보건법)
--     → facilities 에 운영자가 기록하는 플래그 2개 + 확인 시각·메모. 근무자 앱(사업장 시트)·공개 공고 페이지에 표시.
--  ② 허위·과장 구인광고 모니터링 창구: 근무자가 공고·사업장을 신고하면 운영자가 /ops/safety 에서 검토.
--  (구인자 신원 확인 자체는 기존 흐름: 셀프 등록 → 사업자등록증·등록번호 운영자 확인(approved_at) → 국세청 상태조회(NTS) 월 1회 재조회, 휴·폐업·미등록이면 공고 차단)

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS public_flag_wage_arrears boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_flag_industrial_accident boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_flags_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS public_flags_note text CHECK (public_flags_note IS NULL OR char_length(public_flags_note) <= 500);
COMMENT ON COLUMN public.facilities.public_flag_wage_arrears IS '고용노동부 체불사업주 명단 공개 중(근로기준법 §43의2) — 운영자가 월 1회 대조해 기록, 구직자에게 게재(직업안정법 §25)';
COMMENT ON COLUMN public.facilities.public_flag_industrial_accident IS '최근 3년 산업재해 발생건수 공표 사업장(산업안전보건법) — 운영자가 연 1회 공표 목록과 대조해 기록';
COMMENT ON COLUMN public.facilities.public_flags_checked_at IS '공표 정보 마지막 대조 시각';
-- 근무자 앱이 사업장 시트에서 직접 읽는다(approved_at·business_status 와 같은 방식의 컬럼 권한)
GRANT SELECT (public_flag_wage_arrears, public_flag_industrial_accident) ON public.facilities TO authenticated;

-- 공개 공고 페이지(비로그인)용: 공고 id 로 사업장 공표 플래그만 돌려준다. 시연 사업장은 빈 결과.
CREATE OR REPLACE FUNCTION public.get_public_shift_flags(p_id uuid)
RETURNS TABLE(wage_arrears boolean, industrial_accident boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT f.public_flag_wage_arrears, f.public_flag_industrial_accident
  FROM public.shifts s JOIN public.facilities f ON f.id = s.facility_id
  WHERE s.id = p_id AND f.deleted_at IS NULL AND coalesce(f.is_demo, false) = false
$$;
REVOKE ALL ON FUNCTION public.get_public_shift_flags(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_shift_flags(uuid) TO anon, authenticated;

-- ② 공고·사업장 신고
CREATE TABLE IF NOT EXISTS public.job_posting_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('false_ad','wage_mismatch','contact_mismatch','identity','other')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  facility_name_snapshot text NOT NULL,
  shift_snapshot text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  resolution_note text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 year'
);
COMMENT ON TABLE public.job_posting_reports IS '직업안정법 §25 허위·과장 구인광고 모니터링 — 근무자 신고, 운영자 검토. 접수 후 1년 보관';
CREATE UNIQUE INDEX IF NOT EXISTS job_posting_reports_one_per_target
  ON public.job_posting_reports (reporter_user_id, facility_id, coalesce(shift_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS job_posting_reports_status_created ON public.job_posting_reports (status, created_at);
ALTER TABLE public.job_posting_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_posting_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.job_posting_reports TO authenticated;
GRANT ALL ON public.job_posting_reports TO service_role;
DROP POLICY IF EXISTS job_posting_reports_own_read ON public.job_posting_reports;
CREATE POLICY job_posting_reports_own_read ON public.job_posting_reports FOR SELECT TO authenticated USING (reporter_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.report_job_posting(p_facility_id uuid, p_shift_id uuid, p_reason text, p_note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_zero uuid := '00000000-0000-0000-0000-000000000000';
  v_name text; v_shift text; v_id uuid; v_recent integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  IF public.is_demo_account(v_uid) THEN RAISE EXCEPTION '시연에서는 신고를 접수하지 않아요. 내 계정으로 이용해 주세요.'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('false_ad','wage_mismatch','contact_mismatch','identity','other')
     OR char_length(coalesce(p_note, '')) > 1000 THEN
    RAISE EXCEPTION '신고 사유와 내용을 확인해 주세요.';
  END IF;
  SELECT f.name INTO v_name FROM public.facilities f WHERE f.id = p_facility_id AND f.deleted_at IS NULL;
  IF v_name IS NULL THEN RAISE EXCEPTION '신고할 사업장을 찾지 못했어요.'; END IF;
  IF p_shift_id IS NOT NULL THEN
    SELECT s.shift_date::text || ' ' || left(s.start_time::text, 5) || '~' || left(s.end_time::text, 5)
           || ' · ' || s.required_role || ' · 시급 ' || s.hourly_wage::text
      INTO v_shift FROM public.shifts s WHERE s.id = p_shift_id AND s.facility_id = p_facility_id;
    IF v_shift IS NULL THEN RAISE EXCEPTION '신고할 공고를 찾지 못했어요.'; END IF;
  END IF;
  SELECT count(*) INTO v_recent FROM public.job_posting_reports
   WHERE reporter_user_id = v_uid AND created_at > now() - interval '1 day';
  IF v_recent >= 10 THEN RAISE EXCEPTION '신고는 하루 10건까지 접수할 수 있어요.'; END IF;
  INSERT INTO public.job_posting_reports (reporter_user_id, facility_id, shift_id, reason, note, facility_name_snapshot, shift_snapshot)
  VALUES (v_uid, p_facility_id, p_shift_id, p_reason, trim(coalesce(p_note, '')), v_name, v_shift)
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

-- 운영자 검토 — 서버의 운영자 전용 라우트(service_role)만 호출
CREATE OR REPLACE FUNCTION public.review_job_posting_report(p_id uuid, p_status text, p_note text, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_actor IS NULL OR p_status IS NULL OR p_status NOT IN ('reviewing','resolved','dismissed') OR char_length(coalesce(p_note, '')) > 1000 THEN
    RAISE EXCEPTION '검토 결과를 확인해 주세요.';
  END IF;
  UPDATE public.job_posting_reports
     SET status = p_status, resolution_note = trim(coalesce(p_note, '')), reviewed_at = now(), reviewed_by = p_actor
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION '신고를 찾지 못했어요.'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.review_job_posting_report(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_job_posting_report(uuid, text, text, uuid) TO service_role;
