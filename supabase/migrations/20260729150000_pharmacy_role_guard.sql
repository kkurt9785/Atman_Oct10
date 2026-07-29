-- ============================================================================
-- 약국 공고 직군 가드 보강 (2026-07-29 P1 후속)
-- 기존 트리거는 약국+any, 비약국+pharmacy_staff만 막고 약국+rn/na를 허용했다.
-- 약국은 약사/약국 전산·사무직만 모집 가능하도록 차단.
-- (역방향 — 병원이 약사를 모집하는 것 — 은 병원 약제부 채용이 정상이라 허용 유지)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_pharmacy_shift_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $$
DECLARE
  v_type text;
  v_copy text := concat_ws(' ',NEW.description,NEW.department,NEW.notes);
BEGIN
  SELECT facility_type INTO v_type FROM public.facilities WHERE id=NEW.facility_id;

  IF NEW.required_role='pharmacy_staff' THEN
    IF v_type IS DISTINCT FROM 'pharmacy' THEN
      RAISE EXCEPTION '약국 전산·사무직 공고는 약국 사업장에서만 등록할 수 있어요.';
    END IF;
    IF v_copy ~ '(조제|복약[[:space:]]*지도|의약품[[:space:]]*(판매|조제)|처방[[:space:]]*(검토|감사)|최종[[:space:]]*(검수|확인))' THEN
      RAISE EXCEPTION '약국 전산·사무직 공고에는 약사 면허 업무를 포함할 수 없어요.';
    END IF;
  END IF;

  IF v_type='pharmacy' AND NEW.required_role NOT IN ('pharmacist','pharmacy_staff') THEN
    RAISE EXCEPTION '약국 공고는 약사 또는 약국 전산·사무직을 선택해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 출퇴근 RPC의 워커 노출 메시지에서 "병원" → "사업장" (약국 직원에게도 표시됨)
-- ============================================================================
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  patched := def;
  patched := replace(patched, '병원에서 %sm 떨어져 있어요', '사업장에서 %sm 떨어져 있어요');
  patched := replace(patched, '유효한 병원 QR을 먼저 스캔해 주세요', '유효한 사업장 QR을 먼저 스캔해 주세요');
  patched := replace(patched, 'GPS와 QR의 병원 인증 정보가 일치하지 않습니다', 'GPS와 QR의 사업장 인증 정보가 일치하지 않습니다');
  patched := replace(patched, '이 병원은 관리자 승인 방식으로 운영 중이에요', '이 사업장은 관리자 승인 방식으로 운영 중이에요');
  patched := replace(patched, '이 병원에 연결된 직원이 아니에요', '이 사업장에 연결된 직원이 아니에요');
  IF patched = def THEN
    RAISE NOTICE 'attendance message patch skipped: already clean';
  ELSE
    EXECUTE patched;
  END IF;
END $$;

-- 검증: ①트리거가 약국+rn을 막는지 ②출퇴근 메시지에 "병원" 잔재가 없는지
SELECT
  strpos(pg_get_functiondef(to_regprocedure('public.enforce_pharmacy_shift_scope()')),
    'NOT IN (''pharmacist'',''pharmacy_staff'')') > 0 AS pharmacy_role_guard_applied,
  strpos(pg_get_functiondef(to_regprocedure('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)')),
    '병원') = 0 AS attendance_copy_clean;
